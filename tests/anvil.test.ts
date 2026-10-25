import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { publishConfig, readConfig, verifyAnchor } from '../api/_lib/configs'
import { serverEnv } from '../api/_lib/env'
import type { Context } from '../api/_lib/http'
import { createLogger } from '../api/_lib/log'
import { memoryStore, type Store } from '../api/_lib/store'
import { anvilArgs, defaultDna, dnaHash, REGISTRY_KIND } from '../src/protocol/chainDna'
import { REGISTRY_ABI, registerCalldata, registryRecordId } from '../src/protocol/registry'

/** Anvil's first development account. Public, deterministic, holds only devnet ETH. */
const DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const ARTIFACT = new URL('../contracts/out/QForkRegistry.sol/QForkRegistry.json', import.meta.url)
const hasAnvil = spawnSync('anvil', ['--version']).status === 0
const P256_VECTOR =
  '0x4cee90eb86eaa050036147a12d49004b6b9c72bd725d39d4785011fe190f0b4da73bd4903f0ce3b639bbbf6e8e80d16931ff4bcf5993d58468e8fb19086e8cac36dbcd03009df8c59286b162af3bd7fcc0450c9aa81be5d10d312af6c66b1d604aebd3099c618202fcfe16ae7770b0c49ab5eadf74b754204a3bb6060e44eff37618b065f9832de4ca6ca971a7a1adc826d0f7c00181a5fb2ddf79ae00b4e10e'

const nodes: ChildProcess[] = []

async function startAnvil(args: string[], port: number) {
  const node = spawn('anvil', [...args, '--port', String(port), '--silent'], { stdio: 'ignore' })
  nodes.push(node)
  const url = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const ready = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) })
      .then((response) => response.ok)
      .catch(() => false)
    if (ready) return url
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`anvil did not start on ${port}`)
}

afterAll(() => {
  for (const node of nodes) node.kill()
})

describe.skipIf(!hasAnvil)('generated Anvil devnet', () => {
  let rpc: ReturnType<typeof createPublicClient>
  const dna = defaultDna('local-devnet')

  beforeAll(async () => {
    rpc = createPublicClient({ transport: http(await startAnvil(anvilArgs({ ...dna, network: { ...dna.network, chainId: 424242, gasLimit: 45_000_000 } }), 18545)) })
  })

  it('boots with the configured chain ID and gas limit', async () => {
    expect(await rpc.getChainId()).toBe(424242)
    expect((await rpc.getBlock()).gasLimit).toBe(45_000_000n)
  })

  it('has the precompiles the configuration promises', async () => {
    const p256 = await rpc.call({ to: '0x0000000000000000000000000000000000000100', data: P256_VECTOR })
    expect(BigInt(p256.data ?? '0x0')).toBe(1n)
    const bls = await rpc.call({ to: '0x000000000000000000000000000000000000000b', data: `0x${'0'.repeat(512)}` })
    expect(bls.data?.length).toBe(2 + 256)
  })
})

describe.skipIf(!hasAnvil || !existsSync(ARTIFACT))('Base registry on a local chain', () => {
  let store: Store
  let url: string
  const account = privateKeyToAccount(DEV_KEY)
  let registry: Hex
  const context = (): Context => ({
    request: new Request('http://test.local/api'),
    url: new URL('http://test.local/api'),
    env: serverEnv(),
    store,
    log: createLogger({}, 'error'),
    correlationId: 'anvil-test',
    ip: '127.0.0.1',
  })

  beforeAll(async () => {
    url = await startAnvil(['--chain-id', '84532'], 18546)
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { bytecode: { object: Hex } }
    const wallet = createWalletClient({ account, transport: http(url) })
    const rpc = createPublicClient({ transport: http(url) })
    const deployed = await rpc.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: REGISTRY_ABI, bytecode: artifact.bytecode.object, chain: null }) })
    registry = deployed.contractAddress!
    vi.stubEnv('BASE_NETWORK', 'base-sepolia')
    vi.stubEnv('BASE_RPC_URL', url)
    vi.stubEnv('QFORK_REGISTRY_ADDRESS', registry)
    store = memoryStore(true)
  })

  afterAll(() => vi.unstubAllEnvs())

  const send = async (data: Hex, to: Hex = registry) => {
    const wallet = createWalletClient({ account, transport: http(url) })
    const hash = await wallet.sendTransaction({ to, data, chain: null })
    await createPublicClient({ transport: http(url) }).waitForTransactionReceipt({ hash })
    return hash
  }
  const mine = (blocks: number) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_mine', params: [`0x${blocks.toString(16)}`] }) })

  it('anchors a published configuration once Base would call it final', async () => {
    const dna = defaultDna('base')
    const { config } = await publishConfig(context(), dna)
    expect(config.hash).toBe(dnaHash(dna))
    const txHash = await send(registerCalldata(config.hash, REGISTRY_KIND.base, `https://quantumfork.wtf/api/configs?hash=${config.hash}`))

    expect(await verifyAnchor(context(), { hash: config.hash, txHash })).toEqual({ status: 'PENDING' })
    await mine(80)
    const outcome = await verifyAnchor(context(), { hash: config.hash, txHash })
    expect(outcome).toMatchObject({ status: 'VERIFIED', anchor: { creator: account.address, recordId: registryRecordId(account.address, config.hash), version: 1, kind: 1, chainId: 84532 } })
    expect((await readConfig(context(), config.hash)).anchors).toHaveLength(1)

    await verifyAnchor(context(), { hash: config.hash, txHash })
    expect((await readConfig(context(), config.hash)).anchors).toHaveLength(1)
  })

  it('rejects a registration of a different hash or kind, and a reverted one', async () => {
    const dna = { ...defaultDna('base'), name: 'Second Config' }
    const { config } = await publishConfig(context(), dna)
    const other = await send(registerCalldata(`0x${'ab'.repeat(32)}`, REGISTRY_KIND.base, 'x'))
    const wrongKind = await send(registerCalldata(config.hash, REGISTRY_KIND['op-stack'], 'x'))
    await mine(80)
    expect(await verifyAnchor(context(), { hash: config.hash, txHash: other })).toMatchObject({ status: 'FAILED', code: 'NOT_REGISTERED' })
    expect(await verifyAnchor(context(), { hash: config.hash, txHash: wrongKind })).toMatchObject({ status: 'FAILED', code: 'KIND_MISMATCH' })

    const wallet = createWalletClient({ account, transport: http(url) })
    const reverted = await wallet.sendTransaction({ to: registry, data: registerCalldata(config.hash, REGISTRY_KIND['op-stack'], 'x'), gas: 200_000n, chain: null })
    await createPublicClient({ transport: http(url) }).waitForTransactionReceipt({ hash: reverted })
    await mine(80)
    expect(await verifyAnchor(context(), { hash: config.hash, txHash: reverted })).toMatchObject({ status: 'FAILED', code: 'TX_FAILED' })
  })

  it('refuses unpublished hashes and calls to other contracts', async () => {
    await expect(verifyAnchor(context(), { hash: `0x${'cd'.repeat(32)}`, txHash: `0x${'00'.repeat(32)}` })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const { config } = await publishConfig(context(), { ...defaultDna('base'), name: 'Third Config' })
    const elsewhere = await send(registerCalldata(config.hash, REGISTRY_KIND.base, 'x'), account.address)
    await mine(80)
    expect(await verifyAnchor(context(), { hash: config.hash, txHash: elsewhere })).toMatchObject({ status: 'FAILED', code: 'WRONG_CONTRACT' })
  })
})
