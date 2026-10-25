import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeployment, readDeployment, submitBurn } from '../api/_lib/deployments'
import { serverEnv } from '../api/_lib/env'
import { type Context, HttpError } from '../api/_lib/http'
import { createLogger } from '../api/_lib/log'
import { keys, memoryStore, type Store } from '../api/_lib/store'
import { base58Encode } from '../src/protocol/address'
import { defaultConfig } from '../src/protocol/descendant'
import { quoteGenesis, toBaseUnits } from '../src/protocol/pricing'
import { MEMO_PROGRAM, type ParsedTx, TOKEN_2022_PROGRAM } from '../src/protocol/verifyBurn'

const MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const WALLET = 'So11111111111111111111111111111111111111112'
const ACCOUNT = '11111111111111111111111111111111'
const sig = (fill: number) => base58Encode(new Uint8Array(64).fill(fill))

type Chain = { transactions: Map<string, ParsedTx>; statuses: Map<string, { confirmationStatus: string; err: unknown }> }

function mockRpc(chain: Chain) {
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { method, params } = JSON.parse(init.body) as { method: string; params: unknown[] }
    let result: unknown = null
    if (method === 'getAccountInfo') result = { value: { owner: TOKEN_2022_PROGRAM, data: { parsed: { type: 'mint', info: { decimals: 6 } } } } }
    if (method === 'getTransaction') result = chain.transactions.get(params[0] as string) ?? null
    if (method === 'getSignatureStatuses') result = { value: [chain.statuses.get((params[0] as string[])[0]) ?? null] }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 })
  })
}

function burnTx(memo: string, amountRaw: bigint, err: unknown = null): ParsedTx {
  return {
    slot: 99,
    blockTime: 1_760_000_000,
    meta: {
      err,
      preTokenBalances: [{ accountIndex: 1, mint: MINT, uiTokenAmount: { amount: (amountRaw * 2n).toString(), decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 1, mint: MINT, uiTokenAmount: { amount: amountRaw.toString(), decimals: 6 } }],
    },
    transaction: {
      signatures: ['x'],
      message: {
        accountKeys: [
          { pubkey: WALLET, signer: true, writable: true },
          { pubkey: ACCOUNT, signer: false, writable: true },
          { pubkey: MINT, signer: false, writable: true },
        ],
        instructions: [
          { programId: TOKEN_2022_PROGRAM, program: 'spl-token-2022', parsed: { type: 'burnChecked', info: { account: ACCOUNT, mint: MINT, authority: WALLET, tokenAmount: { amount: amountRaw.toString(), decimals: 6 } } } },
          { programId: MEMO_PROGRAM, program: 'spl-memo', parsed: memo },
        ],
      },
    },
  }
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
  vi.stubEnv('SOLANA_NETWORK', 'devnet')
  vi.stubEnv('SOLANA_RPC_URL', 'https://rpc.test.local')
  vi.stubEnv('TOKEN_STATUS', 'LIVE')
  vi.stubEnv('QFORK_MINT', MINT)
  vi.stubEnv('ENABLE_REAL_BURNS', 'true')
  vi.stubEnv('ENABLE_TESTNET_DEPLOYMENTS', 'true')
  store = memoryStore(true)
  chain = { transactions: new Map(), statuses: new Map() }
  mockRpc(chain)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const testnetConfig = () => ({ ...defaultConfig('hybrid'), tier: 'testnet' as const })

describe('server deployment + burn pipeline', () => {
  it('refuses to accept burns without persistent storage', async () => {
    store = memoryStore(false)
    await expect(createDeployment(context(), testnetConfig(), 'idem-key-0000000001')).rejects.toMatchObject({ code: 'STORAGE_NOT_PERSISTENT' })
  })

  it('refuses the mainnet tier on a devnet server', async () => {
    await expect(createDeployment(context(), { ...defaultConfig('hybrid'), tier: 'mainnet' }, 'idem-key-0000000003')).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' })
  })

  it('creates one deployment per idempotency key and computes the burn itself', async () => {
    const first = await createDeployment(context(), testnetConfig(), 'idem-key-0000000004')
    const again = await createDeployment(context(), testnetConfig(), 'idem-key-0000000004')
    expect(again.deployment.id).toBe(first.deployment.id)
    expect(first.deployment.state).toBe('AWAITING_BURN')
    expect(first.deployment.burn.required).toBe(quoteGenesis(testnetConfig()).total)
    expect(first.deployment.descendantId).toBe('QF-0001')
  })

  it('stays pending until finalized, then verifies once and registers the descendant', async () => {
    const { deployment } = await createDeployment(context(), testnetConfig(), 'idem-key-0000000005')
    const signature = sig(1)

    expect((await submitBurn(context(), deployment.id, signature)).status).toBe('PENDING')

    const amount = toBaseUnits(deployment.burn.required, 6)
    chain.transactions.set(signature, burnTx(deployment.burn.memo, amount))
    const verified = await submitBurn(context(), deployment.id, signature)
    expect(verified.status).toBe('VERIFIED')
    if (verified.status !== 'VERIFIED') return
    expect(verified.receipt).toMatchObject({ wallet: WALLET, amountRaw: amount.toString(), deploymentId: deployment.id, verificationStatus: 'VERIFIED' })
    expect(verified.deployment.state).toBe('REGISTERED')
    expect(verified.deployment.history.map((entry) => entry.state)).toEqual(['DRAFT', 'VALIDATED', 'AWAITING_BURN', 'BURN_SUBMITTED', 'BURN_CONFIRMED', 'REGISTERED'])

    const replay = await submitBurn(context(), deployment.id, signature)
    expect(replay.status).toBe('VERIFIED')
    expect(await store.get(keys.burnCount(verified.receipt.network))).toBe('1')
    expect(await store.get(keys.burnedRaw(verified.receipt.network))).toBe(amount.toString())
    expect(await store.get(keys.burnCount('mainnet-beta'))).toBeNull()
  })

  it('never binds one signature to two deployments', async () => {
    const a = await createDeployment(context(), testnetConfig(), 'idem-key-0000000006')
    const b = await createDeployment(context(), testnetConfig(), 'idem-key-0000000007')
    const signature = sig(2)
    chain.transactions.set(signature, burnTx(a.deployment.burn.memo, toBaseUnits(a.deployment.burn.required, 6)))
    expect((await submitBurn(context(), a.deployment.id, signature)).status).toBe('VERIFIED')
    await expect(submitBurn(context(), b.deployment.id, signature)).rejects.toBeInstanceOf(HttpError)
  })

  it('rejects a burn bound to another deployment memo', async () => {
    const a = await createDeployment(context(), testnetConfig(), 'idem-key-0000000008')
    const b = await createDeployment(context(), testnetConfig(), 'idem-key-0000000009')
    const signature = sig(3)
    chain.transactions.set(signature, burnTx(a.deployment.burn.memo, toBaseUnits(b.deployment.burn.required, 6)))
    const outcome = await submitBurn(context(), b.deployment.id, signature)
    expect(outcome).toMatchObject({ status: 'FAILED', code: 'MEMO_MISMATCH' })
    expect(outcome.deployment.state).toBe('BURN_FAILED')
  })

  it('reports wrong amounts as burned-but-not-credited and grants nothing', async () => {
    const { deployment } = await createDeployment(context(), testnetConfig(), 'idem-key-0000000010')
    const signature = sig(4)
    chain.transactions.set(signature, burnTx(deployment.burn.memo, toBaseUnits(1, 6)))
    const outcome = await submitBurn(context(), deployment.id, signature)
    expect(outcome).toMatchObject({ status: 'FAILED', code: 'WRONG_AMOUNT', tokensBurned: true })
    expect(await store.get(keys.receipt(signature))).toBeNull()
    expect((await readDeployment(context(), deployment.id)).deployment.state).toBe('BURN_FAILED')
  })

  it('marks on-chain failures as safe to retry, then accepts a correct retry', async () => {
    const { deployment } = await createDeployment(context(), testnetConfig(), 'idem-key-0000000011')
    const failed = sig(5)
    chain.statuses.set(failed, { confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] } })
    expect(await submitBurn(context(), deployment.id, failed)).toMatchObject({ status: 'FAILED', code: 'TX_FAILED', tokensBurned: false })

    const retry = sig(6)
    chain.transactions.set(retry, burnTx(deployment.burn.memo, toBaseUnits(deployment.burn.required, 6)))
    expect((await submitBurn(context(), deployment.id, retry)).status).toBe('VERIFIED')
  })

  it('expires transactions that never land', async () => {
    const { deployment } = await createDeployment(context(), testnetConfig(), 'idem-key-0000000012')
    vi.useFakeTimers({ toFake: ['Date'] })
    expect((await submitBurn(context(), deployment.id, sig(7))).status).toBe('PENDING')
    vi.setSystemTime(Date.now() + 200_000)
    expect(await submitBurn(context(), deployment.id, sig(7))).toMatchObject({ status: 'FAILED', code: 'TX_EXPIRED', tokensBurned: false })
  })

  it('registers once, lists the descendant, and reads back unchanged', async () => {
    const { deployment } = await createDeployment(context(), testnetConfig(), 'idem-key-0000000013')
    const signature = sig(8)
    chain.transactions.set(signature, burnTx(deployment.burn.memo, toBaseUnits(deployment.burn.required, 6)))
    await submitBurn(context(), deployment.id, signature)
    await submitBurn(context(), deployment.id, signature)
    const read = await readDeployment(context(), deployment.id)
    expect(read.deployment.state).toBe('REGISTERED')
    expect(read.receipt?.signature).toBe(signature)
    expect((await readDeployment(context(), deployment.id)).deployment.version).toBe(read.deployment.version)
    expect(await store.lrange(keys.descendants, 0, -1)).toEqual([deployment.id])
  })
})
