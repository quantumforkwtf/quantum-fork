import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Hex, numberToHex, pad, toEventSelector } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeployment, readDeployment, submitBurn } from '../api/_lib/deployments'
import { serverEnv } from '../api/_lib/env'
import { type Context, HttpError } from '../api/_lib/http'
import { createLogger } from '../api/_lib/log'
import { keys, memoryStore, type Store } from '../api/_lib/store'
import { prepareClanker, verifyClanker } from '../api/_lib/tokens'
import { BURN_ADDRESS, burnCalldata, burnTag, ERC20_BURN_ABI } from '../src/protocol/base'
import { CLANKER_EVENTS, CLANKER_FACTORY, CLANKER_SUPPLY_RAW } from '../src/protocol/clanker'
import { defaultConfig } from '../src/protocol/descendant'
import { quoteGenesis, toBaseUnits } from '../src/protocol/pricing'

const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const WALLET = '0x3333333333333333333333333333333333333333' as Hex
const ZERO = '0x0000000000000000000000000000000000000000' as Hex
const hash = (fill: number) => pad(numberToHex(fill), { size: 32 })

interface FakeTx {
  input: Hex
  to?: Hex
  from?: Hex
  rawLogs?: { address: Hex; topics: Hex[]; data: Hex }[]
  status?: 'success' | 'reverted'
  block?: bigint
  logs?: { from: Hex; to: Hex; value: bigint }[]
}

type Chain = { txs: Map<string, FakeTx>; finalized: bigint }

function mockRpc(chain: Chain) {
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { method, params, id } = JSON.parse(init.body) as { method: string; params: unknown[]; id: number }
    let result: unknown = null
    const tx = chain.txs.get(String(params?.[0]))
    if (method === 'eth_chainId') result = numberToHex(84532)
    if (method === 'eth_call') result = encodeAbiParameters([{ type: 'uint8' }], [18])
    if (method === 'eth_getBlockByNumber') result = block(chain.finalized)
    if (method === 'eth_getTransactionByHash' && tx) {
      result = { hash: params[0], from: tx.from ?? WALLET, to: tx.to ?? TOKEN, input: tx.input, value: '0x0', chainId: numberToHex(84532), type: '0x2', nonce: '0x1', gas: '0x10000', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1', blockNumber: numberToHex(tx.block ?? 10n), blockHash: hash(9), transactionIndex: '0x0', v: '0x0', r: hash(1), s: hash(2), yParity: '0x0', accessList: [] }
    }
    if (method === 'eth_getTransactionReceipt' && tx) {
      result = {
        transactionHash: params[0],
        status: tx.status === 'reverted' ? '0x0' : '0x1',
        blockNumber: numberToHex(tx.block ?? 10n),
        blockHash: hash(9),
        from: tx.from ?? WALLET,
        to: tx.to ?? TOKEN,
        cumulativeGasUsed: '0x1',
        gasUsed: '0x1',
        effectiveGasPrice: '0x1',
        contractAddress: null,
        logsBloom: `0x${'0'.repeat(512)}`,
        transactionIndex: '0x0',
        type: '0x2',
        logs: [
          ...(tx.logs ?? []).map((log) => ({
            address: TOKEN,
            topics: encodeEventTopics({ abi: ERC20_BURN_ABI, eventName: 'Transfer', args: { from: log.from, to: log.to } }),
            data: encodeAbiParameters([{ type: 'uint256' }], [log.value]),
          })),
          ...(tx.rawLogs ?? []),
        ].map((log, index) => ({
          ...log,
          logIndex: numberToHex(index),
          blockNumber: numberToHex(tx.block ?? 10n),
          blockHash: hash(9),
          transactionHash: params[0],
          transactionIndex: '0x0',
          removed: false,
        })),
      }
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

function block(number: bigint) {
  return { number: numberToHex(number), hash: hash(8), parentHash: hash(7), timestamp: '0x1', transactions: [], gasLimit: '0x1', gasUsed: '0x0', baseFeePerGas: '0x1', difficulty: '0x0', extraData: '0x', logsBloom: `0x${'0'.repeat(512)}`, miner: ZERO, mixHash: hash(6), nonce: '0x0000000000000000', receiptsRoot: hash(5), sha3Uncles: hash(4), size: '0x1', stateRoot: hash(3), totalDifficulty: '0x0', transactionsRoot: hash(2), uncles: [] }
}

let store: Store
let chain: Chain
const context = (): Context => ({
  request: new Request('http://test.local/api'),
  url: new URL('http://test.local/api'),
  env: serverEnv(),
  store,
  log: createLogger({}, 'error'),
  correlationId: 'test-correlation',
  ip: '127.0.0.1',
})

beforeEach(() => {
  vi.stubEnv('BASE_NETWORK', 'base-sepolia')
  vi.stubEnv('BASE_RPC_URL', 'https://base.test.local')
  vi.stubEnv('QFORK_BASE_TOKEN', TOKEN)
  vi.stubEnv('ENABLE_BASE_DEPLOYMENTS', 'true')
  store = memoryStore(true)
  chain = { txs: new Map(), finalized: 100n }
  mockRpc(chain)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const testnet = () => ({ ...defaultConfig(), tier: 'testnet' as const })

async function deployment() {
  const { deployment } = await createDeployment(context(), testnet(), 'base-idempotency-key-1', 'base')
  const amountRaw = toBaseUnits(deployment.burn.required, 18)
  return { deployment, amountRaw, tag: burnTag(deployment.burn.memo) }
}

describe('Base deployment + burn pipeline', () => {
  it('binds a Base deployment to the Base token and network', async () => {
    const { deployment: created } = await deployment()
    expect(created.burn).toMatchObject({ chain: 'base', mint: TOKEN, network: 'base-sepolia', signature: null })
  })

  it('requires 10x the Solana amount on Base: 1,000,000 QFORK base, 0.1% of the 1B supply', async () => {
    const { deployment: created } = await deployment()
    expect(quoteGenesis({ ...testnet(), modules: [] }, 'GENESIS', 'base').total).toBe(1_000_000)
    expect(created.burn.required).toBe(quoteGenesis(testnet()).total * 10)
    expect(created.burn.required).toBe(quoteGenesis(testnet(), 'GENESIS', 'base').total)
  })

  it('refuses Base when it is switched off or on the wrong tier', async () => {
    vi.stubEnv('ENABLE_BASE_DEPLOYMENTS', 'false')
    await expect(createDeployment(context(), testnet(), 'base-idempotency-key-2', 'base')).rejects.toBeInstanceOf(HttpError)
    vi.stubEnv('ENABLE_BASE_DEPLOYMENTS', 'true')
    await expect(createDeployment(context(), { ...defaultConfig(), tier: 'mainnet' }, 'base-idempotency-key-3', 'base')).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' })
  })

  it('stays pending until the block is finalized, then registers once', async () => {
    const { deployment: created, amountRaw, tag } = await deployment()
    chain.txs.set(hash(1), { input: burnCalldata(amountRaw, tag), block: 150n, logs: [{ from: WALLET, to: BURN_ADDRESS, value: amountRaw }] })
    expect((await submitBurn(context(), created.id, hash(1))).status).toBe('PENDING')
    chain.finalized = 150n
    const outcome = await submitBurn(context(), created.id, hash(1))
    expect(outcome.status).toBe('VERIFIED')
    if (outcome.status !== 'VERIFIED') return
    expect(outcome.receipt).toMatchObject({ chain: 'base', network: 'base-sepolia', wallet: WALLET, mint: TOKEN, amountRaw: amountRaw.toString(), slot: 150 })
    expect(outcome.deployment.state).toBe('REGISTERED')
    expect(await store.get(keys.burnedWhole('base-sepolia'))).toBe(String(created.burn.required))
    expect((await readDeployment(context(), created.id)).receipt?.signature).toBe(hash(1))
  })

  it('rejects a Solana signature for a Base deployment', async () => {
    const { deployment: created } = await deployment()
    await expect(submitBurn(context(), created.id, '5'.repeat(88))).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
  })

  it('rejects another deployment’s tag and reports the tokens as burned', async () => {
    const { deployment: created, amountRaw } = await deployment()
    chain.txs.set(hash(2), { input: burnCalldata(amountRaw, burnTag('qfork:v1:genesis:dep_zzzzzzzzzzzzzzzz')), logs: [{ from: WALLET, to: BURN_ADDRESS, value: amountRaw }] })
    const outcome = await submitBurn(context(), created.id, hash(2))
    expect(outcome).toMatchObject({ status: 'FAILED', code: 'TAG_MISMATCH', tokensBurned: true })
  })

  it('marks reverted transactions as safe to retry, then accepts a correct retry', async () => {
    const { deployment: created, amountRaw, tag } = await deployment()
    chain.txs.set(hash(3), { input: burnCalldata(amountRaw, tag), status: 'reverted' })
    expect(await submitBurn(context(), created.id, hash(3))).toMatchObject({ status: 'FAILED', code: 'TX_FAILED', tokensBurned: false })
    chain.txs.set(hash(4), { input: burnCalldata(amountRaw, tag), logs: [{ from: WALLET, to: BURN_ADDRESS, value: amountRaw }] })
    expect((await submitBurn(context(), created.id, hash(4))).status).toBe('VERIFIED')
  })

  it('never binds one transaction to two deployments', async () => {
    const { deployment: first, amountRaw, tag } = await deployment()
    chain.txs.set(hash(5), { input: burnCalldata(amountRaw, tag), logs: [{ from: WALLET, to: BURN_ADDRESS, value: amountRaw }] })
    expect((await submitBurn(context(), first.id, hash(5))).status).toBe('VERIFIED')
    const { deployment: second } = await createDeployment(context(), testnet(), 'base-idempotency-key-9', 'base')
    await expect(submitBurn(context(), second.id, hash(5))).rejects.toMatchObject({ code: 'SIGNATURE_USED' })
  })
})

describe('/api/token Base block', () => {
  const getToken = async () => {
    const { GET } = await import('../api/token')
    const response = await GET(new Request('http://test.local/api/token'))
    return (await response.json()) as { base: Record<string, unknown> }
  }

  it('reports Base as prelaunch without touching the Base RPC', async () => {
    const calls = vi.fn()
    vi.stubGlobal('fetch', calls)
    const body = await getToken()
    expect(body.base).toMatchObject({ status: 'PRELAUNCH', network: 'base-sepolia', token: null })
    expect(calls).not.toHaveBeenCalled()
  })

  it('reads supply and decimals from the token contract once live', async () => {
    vi.stubEnv('BASE_TOKEN_STATUS', 'LIVE')
    const body = await getToken()
    expect(body.base).toMatchObject({ status: 'LIVE', token: TOKEN, decimals: 18, supplyRaw: '18', error: null })
  })
})

describe('Clanker descendant launch on Base', () => {
  const NEW_TOKEN = '0x4444444444444444444444444444444444444444' as Hex
  const WETH = '0x4200000000000000000000000000000000000006' as Hex
  const spec = { name: 'Lattice Coin', symbol: 'LAT', description: '' }

  async function registered() {
    vi.stubEnv('ENABLE_CLANKER_LAUNCH', 'true')
    const { deployment: created, amountRaw, tag } = await deployment()
    chain.txs.set(hash(1), { input: burnCalldata(amountRaw, tag), logs: [{ from: WALLET, to: BURN_ADDRESS, value: amountRaw }] })
    expect((await submitBurn(context(), created.id, hash(1))).status).toBe('VERIFIED')
    return created
  }

  function created(deploymentId: string, overrides: { admin?: Hex; context?: string } = {}) {
    const event = CLANKER_EVENTS[0]
    const data = encodeAbiParameters(
      event.inputs.filter((input) => !('indexed' in input && input.indexed)),
      [WALLET, 'img', spec.name, spec.symbol, '{}', overrides.context ?? JSON.stringify({ interface: 'Quantum Fork', messageId: deploymentId }), 0, ZERO, hash(12), WETH, ZERO, ZERO, 0n, []],
    )
    return { address: CLANKER_FACTORY, topics: encodeEventTopics({ abi: CLANKER_EVENTS, eventName: 'TokenCreated', args: { tokenAddress: NEW_TOKEN, tokenAdmin: overrides.admin ?? WALLET } }) as Hex[], data }
  }

  it('decodes the same TokenCreated event the Clanker SDK ABI emits', async () => {
    const { Clanker } = await import('clanker-sdk/v4')
    const built = await new Clanker({}).getDeployTransaction({ name: 'X', symbol: 'X', tokenAdmin: WALLET, chainId: 84532 })
    expect(built.address).toBe(CLANKER_FACTORY)
    const sdk = getAbiItem({ abi: built.abi, name: 'TokenCreated' })
    expect(sdk).toBeDefined()
    expect(toEventSelector(sdk as never)).toBe(toEventSelector(CLANKER_EVENTS[0]))
  })

  it('stays off until ENABLE_CLANKER_LAUNCH is set', async () => {
    const record = await registered()
    vi.stubEnv('ENABLE_CLANKER_LAUNCH', 'false')
    await expect(prepareClanker(context(), { deploymentId: record.id, wallet: WALLET, spec })).rejects.toMatchObject({ code: 'CLANKER_DISABLED' })
  })

  it('only lets the burning wallet launch, in any address case', async () => {
    const record = await registered()
    await expect(prepareClanker(context(), { deploymentId: record.id, wallet: '0x5555555555555555555555555555555555555555', spec })).rejects.toMatchObject({ code: 'NOT_OWNER' })
    const { prepared } = await prepareClanker(context(), { deploymentId: record.id, wallet: WALLET.toUpperCase().replace('0X', '0x'), spec })
    expect(prepared).toMatchObject({ kind: 'clanker', cluster: 'base-sepolia', chainId: 84532, to: CLANKER_FACTORY, pairedToken: WETH })
    expect(prepared.rewardRecipient.toLowerCase()).toBe(WALLET)
    expect(prepared.data.toLowerCase()).toContain(WALLET.slice(2))
    expect(prepared.data).toContain(Buffer.from(record.id).toString('hex'))
    expect(prepared.image).toBe(`${serverEnv().config.siteUrl}/api/og?token=${prepared.launchId}`)
    const metadata = JSON.parse((await store.get(keys.meta(prepared.launchId))) ?? '{}') as { attributes: unknown[] }
    expect(metadata.attributes).toContainEqual({ trait_type: 'Ancestor', value: 'Base' })
  })

  it('waits for the transaction and finality, then records the token once', async () => {
    const record = await registered()
    const { prepared } = await prepareClanker(context(), { deploymentId: record.id, wallet: WALLET, spec })
    expect(await verifyClanker(context(), { launchId: prepared.launchId, hash: hash(20) })).toEqual({ status: 'PENDING' })
    chain.txs.set(hash(20), { input: prepared.data as Hex, to: CLANKER_FACTORY, block: 150n, rawLogs: [created(record.id)] })
    expect(await verifyClanker(context(), { launchId: prepared.launchId, hash: hash(20) })).toEqual({ status: 'PENDING' })
    chain.finalized = 150n
    const outcome = await verifyClanker(context(), { launchId: prepared.launchId, hash: hash(20) })
    expect(outcome).toMatchObject({ status: 'VERIFIED', token: { mint: NEW_TOKEN, kind: 'clanker', cluster: 'base-sepolia', decimals: 18, supplyRaw: CLANKER_SUPPLY_RAW.toString(), creator: WALLET } })
    expect(await store.lrange(keys.tokensOf(record.id), 0, -1)).toEqual([NEW_TOKEN])
    await verifyClanker(context(), { launchId: prepared.launchId, hash: hash(20) })
    expect(await store.lrange(keys.tokensOf(record.id), 0, -1)).toEqual([NEW_TOKEN])
  })

  it('rejects modified calldata, a foreign admin and another descendant’s context', async () => {
    const record = await registered()
    const { prepared } = await prepareClanker(context(), { deploymentId: record.id, wallet: WALLET, spec })
    const verify = (fill: number, tx: Parameters<typeof chain.txs.set>[1]) => {
      chain.txs.set(hash(fill), tx)
      return verifyClanker(context(), { launchId: prepared.launchId, hash: hash(fill) })
    }
    const data = prepared.data as Hex
    expect(await verify(21, { input: `${data.slice(0, -2)}ff` as Hex, to: CLANKER_FACTORY, rawLogs: [created(record.id)] })).toMatchObject({ code: 'TX_MODIFIED' })
    expect(await verify(22, { input: data, to: TOKEN, rawLogs: [created(record.id)] })).toMatchObject({ code: 'WRONG_CONTRACT' })
    expect(await verify(23, { input: data, to: CLANKER_FACTORY, from: '0x5555555555555555555555555555555555555555', rawLogs: [created(record.id)] })).toMatchObject({ code: 'WRONG_SENDER' })
    expect(await verify(24, { input: data, to: CLANKER_FACTORY, rawLogs: [created(record.id, { admin: '0x5555555555555555555555555555555555555555' })] })).toMatchObject({ code: 'ADMIN_MISMATCH' })
    expect(await verify(25, { input: data, to: CLANKER_FACTORY, rawLogs: [created(record.id, { context: JSON.stringify({ messageId: 'dep_other' }) })] })).toMatchObject({ code: 'CONTEXT_MISMATCH' })
    expect(await verify(26, { input: data, to: CLANKER_FACTORY })).toMatchObject({ code: 'NO_TOKEN_CREATED' })
    expect(await store.lrange(keys.tokensOf(record.id), 0, -1)).toEqual([])
  })
})
