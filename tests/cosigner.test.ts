import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js'
import { createPublicClient, createWalletClient, getAddress, type Hex, http, parseEther, toHex, zeroHash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadOrCreateKey, startCosigner } from '../cosigner/server'
import {
  ACCOUNT_ABI,
  ACCOUNT_FACTORY_ABI,
  createAccountCalldata,
  executeCalldata,
  type KeysetDescriptor,
  keysetCommitment,
  ownerActionCalldata,
  ownerActionsCalldata,
  proposeOwnerAction,
  submitCalldata,
} from '../src/protocol/account'
import { type CosignChainState, checkCosign, cosignClass, cosignDigest, type CosignRequest, parseCosignRequest, signCosign } from '../src/protocol/cosigner'

/** Anvil's public development accounts. Devnet ETH only. */
const WALLET = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const BACKUP = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const NEW_WALLET = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')
/** Anvil development account #4, standing in for the hosted co-signer's server key. */
const HOSTED_KEY = '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' as Hex
const SHOP = '0x00000000000000000000000000000000000005b0' as Hex
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Hex
const ARTIFACT = new URL('../contracts/out/QForkAccountFactory.sol/QForkAccountFactory.json', import.meta.url)
const hasAnvil = spawnSync('anvil', ['--version']).status === 0

const daily = ml_dsa65.keygen()
const recovery = slh_dsa_sha2_128s.keygen()
const guardians = [ml_dsa65.keygen(), ml_dsa65.keygen(), ml_dsa65.keygen()]

/** One daily key, one recovery key; recovery needs 1. */
const personal: KeysetDescriptor = {
  version: 1,
  recoveryThreshold: 1,
  keys: [
    { scheme: 'ml-dsa-65', role: 'authorize', publicKey: toHex(daily.publicKey) },
    { scheme: 'slh-dsa-sha2-128s', role: 'recovery', publicKey: toHex(recovery.publicKey) },
  ],
}

/** One daily key and three guardians; any two guardians can recover. */
const guarded: KeysetDescriptor = {
  version: 1,
  recoveryThreshold: 2,
  keys: [{ scheme: 'ml-dsa-65', role: 'authorize', publicKey: toHex(daily.publicKey) }, ...guardians.map((key) => ({ scheme: 'ml-dsa-65' as const, role: 'guardian' as const, publicKey: toHex(key.publicKey) }))],
}

const payment = { to: SHOP, value: parseEther('1'), data: '0x' as Hex }
const swapOwner = { to: ACCOUNT, value: 0n, data: ownerActionsCalldata([{ kind: 'removeOwner', owner: WALLET.address, threshold: 2 }, { kind: 'addOwner', owner: NEW_WALLET.address, threshold: 2 }]) }

const stateFor = (descriptor: KeysetDescriptor, proposal = payment, overrides: Partial<CosignChainState> = {}): CosignChainState => ({
  chainId: 8453,
  keyset: keysetCommitment(descriptor),
  cosignerIsOwner: true,
  alreadyApproved: false,
  proposal: { ...proposal, executed: false, cancelled: false },
  ...overrides,
})

const digestFor = (descriptor: KeysetDescriptor, proposal = payment, proposalId = 0n) => cosignDigest({ chainId: 8453, account: ACCOUNT, proposalId, ...proposal, keyset: keysetCommitment(descriptor) })

const requestFor = (descriptor: KeysetDescriptor, signatures: CosignRequest['signatures'], proposalId = 0n): CosignRequest => ({ version: 1, chainId: 8453, account: ACCOUNT, proposalId, descriptor, signatures })

describe('co-signer policy', () => {
  it('signs one proposal on one account, chain and key set', () => {
    const base = { chainId: 8453, account: ACCOUNT, proposalId: 0n, ...payment, keyset: keysetCommitment(personal) }
    const digest = cosignDigest(base)
    for (const change of [{ chainId: 84532 }, { account: SHOP }, { proposalId: 1n }, { to: ACCOUNT }, { value: 2n }, { data: '0x00' as Hex }, { keyset: zeroHash }]) {
      expect(cosignDigest({ ...base, ...change })).not.toBe(digest)
    }
  })

  it('needs recovery keys only for changes to who controls the account', () => {
    expect(cosignClass(ACCOUNT, payment)).toBe('authorize')
    expect(cosignClass(ACCOUNT, { to: SHOP, value: 0n, data: '0xa9059cbb' })).toBe('authorize')
    expect(cosignClass(ACCOUNT, { to: ACCOUNT, value: 0n, data: ownerActionCalldata({ kind: 'unfreeze', spender: SHOP }) })).toBe('authorize')
    expect(cosignClass(ACCOUNT, swapOwner)).toBe('recovery')
    expect(cosignClass(ACCOUNT, { to: ACCOUNT, value: 0n, data: ownerActionCalldata({ kind: 'setThreshold', threshold: 1 }) })).toBe('recovery')
    expect(cosignClass(ACCOUNT, { to: ACCOUNT, value: 0n, data: ownerActionsCalldata([{ kind: 'unfreeze', spender: SHOP }, { kind: 'rotateKeyset', commitment: zeroHash }]) })).toBe('recovery')
    expect(cosignClass(ACCOUNT, { to: ACCOUNT, value: 0n, data: '0xdeadbeef' })).toBe('recovery')
    expect(cosignClass(ACCOUNT, { to: ACCOUNT, value: 1n, data: '0x' })).toBe('recovery')
  })

  it('approves a payment signed by the daily key, and nothing else', () => {
    const digest = digestFor(personal)
    const good = signCosign('ml-dsa-65', daily.secretKey, digest)
    expect(checkCosign(requestFor(personal, [{ publicKey: toHex(daily.publicKey), signature: good }]), stateFor(personal))).toMatchObject({ ok: true, class: 'authorize', digest })

    const other = ml_dsa65.keygen()
    const stranger = signCosign('ml-dsa-65', other.secretKey, digest)
    expect(checkCosign(requestFor(personal, [{ publicKey: toHex(other.publicKey), signature: stranger }]), stateFor(personal))).toMatchObject({ ok: false, code: 'NOT_AUTHORIZED' })
    expect(checkCosign(requestFor(personal, [{ publicKey: toHex(daily.publicKey), signature: stranger }]), stateFor(personal))).toMatchObject({ ok: false, code: 'NOT_AUTHORIZED' })
    const forOtherProposal = signCosign('ml-dsa-65', daily.secretKey, digestFor(personal, payment, 1n))
    expect(checkCosign(requestFor(personal, [{ publicKey: toHex(daily.publicKey), signature: forOtherProposal }]), stateFor(personal))).toMatchObject({ ok: false, code: 'NOT_AUTHORIZED' })
  })

  it('needs the recovery key, not the daily key, to swap an owner', () => {
    const digest = digestFor(personal, swapOwner)
    const dailySig = { publicKey: toHex(daily.publicKey), signature: signCosign('ml-dsa-65', daily.secretKey, digest) }
    expect(checkCosign(requestFor(personal, [dailySig]), stateFor(personal, swapOwner))).toMatchObject({ ok: false, code: 'NOT_ENOUGH_SIGNATURES' })
    const recoverySig = { publicKey: toHex(recovery.publicKey), signature: signCosign('slh-dsa-sha2-128s', recovery.secretKey, digest) }
    expect(checkCosign(requestFor(personal, [dailySig, recoverySig]), stateFor(personal, swapOwner))).toMatchObject({ ok: true, class: 'recovery', signers: [toHex(recovery.publicKey)] })
  })

  it('counts each guardian once toward the quorum', () => {
    const digest = digestFor(guarded, swapOwner)
    const [first, second] = guardians.map((key) => ({ publicKey: toHex(key.publicKey), signature: signCosign('ml-dsa-65', key.secretKey, digest) }))
    expect(checkCosign(requestFor(guarded, [first]), stateFor(guarded, swapOwner))).toMatchObject({ ok: false, code: 'NOT_ENOUGH_SIGNATURES', message: expect.stringMatching(/needs 2 .* has 1/) })
    expect(checkCosign(requestFor(guarded, [first, first]), stateFor(guarded, swapOwner))).toMatchObject({ ok: false, code: 'NOT_ENOUGH_SIGNATURES' })
    expect(checkCosign(requestFor(guarded, [first, second]), stateFor(guarded, swapOwner))).toMatchObject({ ok: true, class: 'recovery' })
  })

  it('refuses before checking signatures when the chain says no', () => {
    const request = requestFor(personal, [{ publicKey: toHex(daily.publicKey), signature: signCosign('ml-dsa-65', daily.secretKey, digestFor(personal)) }])
    expect(checkCosign(request, stateFor(personal, payment, { chainId: 84532 }))).toMatchObject({ code: 'WRONG_CHAIN' })
    expect(checkCosign(request, stateFor(personal, payment, { cosignerIsOwner: false }))).toMatchObject({ code: 'NOT_AN_OWNER' })
    expect(checkCosign(request, stateFor(personal, payment, { keyset: zeroHash }))).toMatchObject({ code: 'NO_KEYSET' })
    expect(checkCosign(request, stateFor(personal, payment, { keyset: keysetCommitment(guarded) }))).toMatchObject({ code: 'KEYSET_MISMATCH' })
    expect(checkCosign(request, stateFor(personal, payment, { proposal: null }))).toMatchObject({ code: 'UNKNOWN_PROPOSAL' })
    expect(checkCosign(request, stateFor(personal, payment, { proposal: { ...payment, executed: true, cancelled: false } }))).toMatchObject({ code: 'PROPOSAL_CLOSED' })
    expect(checkCosign(request, stateFor(personal, payment, { alreadyApproved: true }))).toMatchObject({ code: 'ALREADY_APPROVED' })
  })

  it('parses only well-formed requests', () => {
    const body = { version: 1, chainId: 8453, account: ACCOUNT, proposalId: '0', descriptor: personal, signatures: [{ publicKey: toHex(daily.publicKey), signature: '0x00' }] }
    expect(parseCosignRequest(body)).toMatchObject({ chainId: 8453, proposalId: 0n, account: getAddress(ACCOUNT) })
    expect(parseCosignRequest(null)).toMatch(/JSON object/)
    expect(parseCosignRequest({ ...body, version: 2 })).toMatch(/version/)
    expect(parseCosignRequest({ ...body, account: 'nope' })).toMatch(/address/)
    expect(parseCosignRequest({ ...body, proposalId: 0 })).toMatch(/decimal/)
    expect(parseCosignRequest({ ...body, proposalId: '-1' })).toMatch(/decimal/)
    expect(parseCosignRequest({ ...body, descriptor: { ...personal, recoveryThreshold: '1' } })).toMatch(/integer/)
    expect(parseCosignRequest({ ...body, descriptor: { ...personal, recoveryThreshold: 3 } })).toMatch(/between 1 and 1/)
    expect(parseCosignRequest({ ...body, signatures: [] })).toMatch(/at least one/)
    expect(parseCosignRequest({ ...body, signatures: [{ publicKey: 'x', signature: '0x' }] })).toMatch(/hex/)
    expect(parseCosignRequest({ ...body, signatures: Array(33).fill(body.signatures[0]) })).toMatch(/At most 32/)
  })
})

describe('co-signer key file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qfork-cosigner-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('creates the key once, readable only by its owner, and reuses it', () => {
    const file = join(dir, 'nested', 'key.json')
    const first = loadOrCreateKey(file)
    expect(first.created).toBe(true)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ format: 'qfork.cosigner.v1', address: first.address })
    const again = loadOrCreateKey(file)
    expect(again).toMatchObject({ created: false, address: first.address })
  })
})

const nodes: ChildProcess[] = []
afterAll(() => nodes.forEach((node) => node.kill()))

describe.skipIf(!hasAnvil || !existsSync(ARTIFACT))('self-hosted co-signer on a local chain', () => {
  const rpcUrl = 'http://127.0.0.1:18549'
  const origin = 'https://quantumfork.wtf'
  const dir = mkdtempSync(join(tmpdir(), 'qfork-cosigner-e2e-'))
  const rpc = () => createPublicClient({ transport: http(rpcUrl) })
  let server: Server
  let cosignerUrl: string
  let cosigner: Hex
  let account: Hex
  let factoryAddress: Hex

  const send = async (signer: typeof WALLET, to: Hex, data: Hex, value = 0n) => {
    const hash = await createWalletClient({ account: signer, transport: http(rpcUrl) }).sendTransaction({ to, data, value, chain: null })
    const receipt = await rpc().waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')
  }
  const post = (body: unknown, from = origin) => fetch(`${cosignerUrl}/v1/cosign`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from }, body: JSON.stringify(body) })
  const body = (proposalId: bigint, signatures: CosignRequest['signatures']) => ({ version: 1, chainId: 84532, account, proposalId: proposalId.toString(), descriptor: personal, signatures })
  const digestOn = async (proposalId: bigint) => {
    const proposal = await rpc().readContract({ address: account, abi: ACCOUNT_ABI, functionName: 'proposal', args: [proposalId] })
    return cosignDigest({ chainId: 84532, account, proposalId, to: proposal.to, value: proposal.value, data: proposal.data, keyset: keysetCommitment(personal) })
  }
  const approved = (proposalId: bigint) => rpc().readContract({ address: account, abi: ACCOUNT_ABI, functionName: 'hasApproved', args: [proposalId, cosigner] })

  beforeAll(async () => {
    nodes.push(spawn('anvil', ['--chain-id', '84532', '--port', '18549', '--silent'], { stdio: 'ignore' }))
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await rpc().getChainId().then(() => true, () => false)) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const started = await startCosigner({ rpcUrl, chainId: 84532, network: 'base-sepolia', keyFile: join(dir, 'key.json'), port: 0, origins: [origin] })
    server = started.server
    cosignerUrl = started.url
    cosigner = started.address

    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { bytecode: { object: Hex } }
    const deployed = await rpc().waitForTransactionReceipt({ hash: await createWalletClient({ account: WALLET, transport: http(rpcUrl) }).deployContract({ abi: ACCOUNT_FACTORY_ABI, bytecode: artifact.bytecode.object, chain: null }) })
    const factory = deployed.contractAddress!
    factoryAddress = factory
    await send(WALLET, privateKeyToAccount(HOSTED_KEY).address, '0x', parseEther('1'))
    const owners = [WALLET.address, cosigner, BACKUP.address]
    const salt = toHex('cosigned', { size: 32 })
    account = await rpc().readContract({ address: factory, abi: ACCOUNT_FACTORY_ABI, functionName: 'predict', args: [WALLET.address, owners, 2, keysetCommitment(personal), salt] })
    await send(WALLET, factory, createAccountCalldata(owners, 2, keysetCommitment(personal), salt))
    await send(WALLET, account, '0x', parseEther('5'))
    await send(WALLET, cosigner, '0x', parseEther('1'))
  }, 30_000)

  afterAll(() => {
    server?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports its address, and only to allowed origins', async () => {
    const info = await fetch(`${cosignerUrl}/v1/info`, { headers: { Origin: origin } })
    expect(info.headers.get('access-control-allow-origin')).toBe(origin)
    expect(await info.json()).toMatchObject({ name: 'qfork-cosigner', mode: 'self-hosted', address: cosigner, chainId: 84532 })
    const preflight = await fetch(`${cosignerUrl}/v1/cosign`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Private-Network': 'true' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true')
    expect((await post({}, 'https://evil.example')).status).toBe(403)
  })

  it('co-signs a payment the daily key signed, so the wallet can execute it', async () => {
    await send(WALLET, account, submitCalldata(SHOP, parseEther('1'), '0x'))
    const unsigned = await post(body(0n, [{ publicKey: toHex(daily.publicKey), signature: toHex(new Uint8Array(3309)) }]))
    expect(unsigned.status).toBe(422)
    expect(await unsigned.json()).toMatchObject({ error: { code: 'NOT_AUTHORIZED' } })
    expect(await approved(0n)).toBe(false)

    const signed = await post(body(0n, [{ publicKey: toHex(daily.publicKey), signature: signCosign('ml-dsa-65', daily.secretKey, await digestOn(0n)) }]))
    expect(signed.status).toBe(200)
    expect(await signed.json()).toMatchObject({ class: 'authorize', signers: 1 })
    expect(await approved(0n)).toBe(true)
    await send(WALLET, account, executeCalldata(0n))
    expect(await rpc().getBalance({ address: SHOP })).toBe(parseEther('1'))

    const again = await post(body(0n, [{ publicKey: toHex(daily.publicKey), signature: signCosign('ml-dsa-65', daily.secretKey, await digestOn(0n)) }]))
    expect(await again.json()).toMatchObject({ error: { code: 'PROPOSAL_CLOSED' } })
  })

  it('replaces a lost wallet only with the post-quantum recovery key', async () => {
    await send(BACKUP, account, proposeOwnerAction(account, { kind: 'removeOwner', owner: WALLET.address, threshold: 2 }, { kind: 'addOwner', owner: NEW_WALLET.address, threshold: 2 }))
    const digest = await digestOn(1n)
    const withDaily = await post(body(1n, [{ publicKey: toHex(daily.publicKey), signature: signCosign('ml-dsa-65', daily.secretKey, digest) }]))
    expect(await withDaily.json()).toMatchObject({ error: { code: 'NOT_ENOUGH_SIGNATURES' } })
    expect(await approved(1n)).toBe(false)

    const withRecovery = await post(body(1n, [{ publicKey: toHex(recovery.publicKey), signature: signCosign('slh-dsa-sha2-128s', recovery.secretKey, digest) }]))
    expect(await withRecovery.json()).toMatchObject({ class: 'recovery', signers: 1 })
    await send(BACKUP, account, executeCalldata(1n))
    const owners = await rpc().readContract({ address: account, abi: ACCOUNT_ABI, functionName: 'owners' })
    expect(new Set(owners)).toEqual(new Set([cosigner, BACKUP.address, NEW_WALLET.address]))
  }, 30_000)

  it('runs the same checks as the hosted co-signer, which is off unless enabled', async () => {
    const { GET, POST } = await import('../api/cosign')
    const call = (payload: unknown) => POST(new Request('http://localhost/api/cosign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
    vi.stubEnv('BASE_NETWORK', 'base-sepolia')
    vi.stubEnv('BASE_RPC_URL', rpcUrl)
    vi.stubEnv('ENABLE_HOSTED_COSIGNER', 'false')
    vi.stubEnv('COSIGNER_PRIVATE_KEY', HOSTED_KEY)
    try {
      expect(await (await GET(new Request('http://localhost/api/cosign'))).json()).toMatchObject({ mode: 'hosted', trust: 'server-trusted', enabled: false, address: null })
      expect((await call({})).status).toBe(503)

      vi.stubEnv('ENABLE_HOSTED_COSIGNER', 'true')
      const hosted = privateKeyToAccount(HOSTED_KEY).address
      expect(await (await GET(new Request('http://localhost/api/cosign'))).json()).toMatchObject({ enabled: true, address: hosted, chainId: 84532 })
      const owners = [WALLET.address, hosted]
      const salt = toHex('hosted', { size: 32 })
      const hostedAccount = await rpc().readContract({ address: factoryAddress, abi: ACCOUNT_FACTORY_ABI, functionName: 'predict', args: [WALLET.address, owners, 2, keysetCommitment(personal), salt] })
      await send(WALLET, factoryAddress, createAccountCalldata(owners, 2, keysetCommitment(personal), salt))
      await send(WALLET, hostedAccount, submitCalldata(SHOP, 1n, '0x'))
      const proposal = await rpc().readContract({ address: hostedAccount, abi: ACCOUNT_ABI, functionName: 'proposal', args: [0n] })
      const digest = cosignDigest({ chainId: 84532, account: hostedAccount, proposalId: 0n, to: proposal.to, value: proposal.value, data: proposal.data, keyset: keysetCommitment(personal) })
      const payload = { ...body(0n, []), account: hostedAccount, signatures: [{ publicKey: toHex(daily.publicKey), signature: toHex(new Uint8Array(3309)) }] }
      const refused = await call(payload)
      expect(refused.status).toBe(422)
      expect(await refused.json()).toMatchObject({ error: { code: 'NOT_AUTHORIZED' } })
      const approvedResponse = await call({ ...payload, signatures: [{ publicKey: toHex(daily.publicKey), signature: signCosign('ml-dsa-65', daily.secretKey, digest) }] })
      expect(await approvedResponse.json()).toMatchObject({ class: 'authorize', trust: 'server-trusted' })
      expect(await rpc().readContract({ address: hostedAccount, abi: ACCOUNT_ABI, functionName: 'hasApproved', args: [0n, hosted] })).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  }, 30_000)

  it('refuses addresses without an account', async () => {
    const notAccount = { ...body(0n, [{ publicKey: toHex(daily.publicKey), signature: '0x00' }]), account: SHOP }
    expect(await (await post(notAccount)).json()).toMatchObject({ error: { code: 'NOT_AN_ACCOUNT' } })
  })
})
