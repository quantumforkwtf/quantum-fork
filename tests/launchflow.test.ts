import { Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeployment, submitBurn } from '../api/_lib/deployments'
import { serverEnv } from '../api/_lib/env'
import { dripFaucet, faucetAvailability, FAUCET_QFORK } from '../api/_lib/faucet'
import { type Context } from '../api/_lib/http'
import { createLogger } from '../api/_lib/log'
import { keys, memoryStore, type Store } from '../api/_lib/store'
import { prepareSpl, tokensOf, verifyLaunch } from '../api/_lib/tokens'
import { base58Encode, metadataAddress, TOKEN_METADATA_PROGRAM } from '../src/protocol/address'
import { defaultConfig } from '../src/protocol/descendant'
import { toBaseUnits } from '../src/protocol/pricing'
import { tokenMemo } from '../src/protocol/tokens'
import { MEMO_PROGRAM, type ParsedTx, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../src/protocol/verifyBurn'

const QFORK = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const OWNER = Keypair.generate().publicKey.toBase58()
const STRANGER = Keypair.generate().publicKey.toBase58()
const ACCOUNT = '11111111111111111111111111111111'
const faucetAuthority = Keypair.generate()
const sig = (fill: number) => base58Encode(new Uint8Array(64).fill(fill))

type AccountFixture = { owner: string; parsed?: { type: string; info: Record<string, unknown> }; base64?: string }
let accounts: Map<string, AccountFixture>
let transactions: Map<string, ParsedTx>
let sent: string[]

function mockRpc() {
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { method, params } = JSON.parse(init.body) as { method: string; params: unknown[] }
    let result: unknown = null
    if (method === 'getAccountInfo') {
      const fixture = accounts.get(params[0] as string)
      const encoding = (params[1] as { encoding: string }).encoding
      if (fixture && encoding === 'jsonParsed' && fixture.parsed) result = { value: { owner: fixture.owner, data: { parsed: fixture.parsed } } }
      else if (fixture && encoding === 'base64' && fixture.base64) result = { value: { owner: fixture.owner, data: [fixture.base64, 'base64'] } }
      else result = { value: null }
    }
    if (method === 'getTransaction') result = transactions.get(params[0] as string) ?? null
    if (method === 'getSignatureStatuses') result = { value: [null] }
    if (method === 'getBalance') result = { value: 0 }
    if (method === 'getLatestBlockhash') result = { value: { blockhash: base58Encode(new Uint8Array(32).fill(3)), lastValidBlockHeight: 100 } }
    if (method === 'sendTransaction') {
      sent.push(params[0] as string)
      result = sig(77)
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 })
  })
}

function burnTx(memo: string, amountRaw: bigint): ParsedTx {
  return {
    slot: 99,
    blockTime: 1_760_000_000,
    meta: {
      err: null,
      preTokenBalances: [{ accountIndex: 1, mint: QFORK, uiTokenAmount: { amount: (amountRaw * 2n).toString(), decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 1, mint: QFORK, uiTokenAmount: { amount: amountRaw.toString(), decimals: 6 } }],
    },
    transaction: {
      signatures: ['x'],
      message: {
        accountKeys: [
          { pubkey: OWNER, signer: true, writable: true },
          { pubkey: ACCOUNT, signer: false, writable: true },
          { pubkey: QFORK, signer: false, writable: true },
        ],
        instructions: [
          { programId: TOKEN_2022_PROGRAM, program: 'spl-token-2022', parsed: { type: 'burnChecked', info: { account: ACCOUNT, mint: QFORK, authority: OWNER, tokenAmount: { amount: amountRaw.toString(), decimals: 6 } } } },
          { programId: MEMO_PROGRAM, program: 'spl-memo', parsed: memo },
        ],
      },
    },
  }
}

function createTx(mint: string, payer: string, memo: string): ParsedTx {
  return {
    slot: 120,
    blockTime: 1_760_000_100,
    meta: { err: null, preTokenBalances: [], postTokenBalances: [] },
    transaction: {
      signatures: ['y'],
      message: {
        accountKeys: [
          { pubkey: payer, signer: true, writable: true },
          { pubkey: mint, signer: false, writable: true },
        ],
        instructions: [
          { programId: TOKEN_PROGRAM, program: 'spl-token', parsed: { type: 'initializeMint2', info: { mint, decimals: 6, mintAuthority: payer } } },
          { programId: MEMO_PROGRAM, program: 'spl-memo', parsed: memo },
        ],
      },
    },
  }
}

let store: Store
const context = (ip = '10.0.0.1'): Context => ({
  request: new Request('http://test.local/api'),
  url: new URL('http://test.local/api'),
  env: serverEnv(),
  store,
  log: createLogger({}, 'error'),
  correlationId: 'test-correlation',
  ip,
})

async function registered() {
  const { deployment } = await createDeployment(context(), { ...defaultConfig('hybrid'), tier: 'testnet' }, `idem-key-${Math.random().toString(36).slice(2, 14)}`)
  const signature = sig(1)
  transactions.set(signature, burnTx(deployment.burn.memo, toBaseUnits(deployment.burn.required, 6)))
  const outcome = await submitBurn(context(), deployment.id, signature)
  expect(outcome.status).toBe('VERIFIED')
  return outcome.deployment
}

beforeEach(() => {
  vi.stubEnv('SOLANA_NETWORK', 'devnet')
  vi.stubEnv('SOLANA_RPC_URL', 'https://rpc.test.local')
  vi.stubEnv('TOKEN_STATUS', 'PRELAUNCH')
  vi.stubEnv('QFORK_MINT', QFORK)
  vi.stubEnv('ENABLE_REAL_BURNS', 'true')
  vi.stubEnv('ENABLE_TESTNET_DEPLOYMENTS', 'true')
  vi.stubEnv('SITE_URL', 'https://quantumfork.wtf')
  vi.stubEnv('QFORK_FAUCET_KEYPAIR', JSON.stringify([...faucetAuthority.secretKey]))
  store = memoryStore(true)
  accounts = new Map([[QFORK, { owner: TOKEN_2022_PROGRAM, parsed: { type: 'mint', info: { decimals: 6, mintAuthority: faucetAuthority.publicKey.toBase58() } } }]])
  transactions = new Map()
  sent = []
  mockRpc()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('token launch pipeline', () => {
  const spec = { name: 'Lattice', symbol: 'LAT', description: '', decimals: 6, supply: '1000000', fixedSupply: true }

  it('lets only the wallet that burned prepare a launch', async () => {
    const deployment = await registered()
    await expect(prepareSpl(context(), { deploymentId: deployment.id, wallet: STRANGER, spec })).rejects.toMatchObject({ code: 'NOT_OWNER' })
    const { prepared, memo } = await prepareSpl(context(), { deploymentId: deployment.id, wallet: OWNER, spec })
    expect(prepared).toMatchObject({ kind: 'spl', cluster: 'devnet', wallet: OWNER, deploymentId: deployment.id })
    expect(memo).toBe(tokenMemo(deployment.id))
    expect(prepared.uri).toBe(`https://quantumfork.wtf/api/tokens?meta=${prepared.mint}`)
  })

  it('records a token only after reading its creation and mint from the chain', async () => {
    const deployment = await registered()
    const { prepared, memo } = await prepareSpl(context(), { deploymentId: deployment.id, wallet: OWNER, spec })
    const signature = sig(9)

    expect(await verifyLaunch(context(), { mint: prepared.mint, signature })).toEqual({ status: 'PENDING' })

    transactions.set(signature, createTx(prepared.mint, STRANGER, memo))
    expect(await verifyLaunch(context(), { mint: prepared.mint, signature })).toMatchObject({ status: 'FAILED', code: 'WRONG_PAYER' })
    expect(await tokensOf(context(), deployment.id)).toEqual([])

    transactions.set(signature, createTx(prepared.mint, OWNER, memo))
    accounts.set(prepared.mint, { owner: TOKEN_PROGRAM, parsed: { type: 'mint', info: { decimals: 6, supply: '1000000000000', mintAuthority: null } } })
    const outcome = await verifyLaunch(context(), { mint: prepared.mint, signature })
    expect(outcome.status).toBe('VERIFIED')
    if (outcome.status !== 'VERIFIED') return
    expect(outcome.token).toMatchObject({ mint: prepared.mint, creator: OWNER, supplyRaw: '1000000000000', mintAuthority: null, deploymentId: deployment.id, signature })

    expect(await verifyLaunch(context(), { mint: prepared.mint, signature })).toMatchObject({ status: 'VERIFIED' })
    expect((await tokensOf(context(), deployment.id)).map((token) => token.mint)).toEqual([prepared.mint])
    expect(await store.lrange(keys.tokens, 0, -1)).toEqual([prepared.mint])
  })

  it('prefers the name and symbol written on-chain over what was prepared', async () => {
    const deployment = await registered()
    const { prepared, memo } = await prepareSpl(context(), { deploymentId: deployment.id, wallet: OWNER, spec })
    const signature = sig(10)
    transactions.set(signature, createTx(prepared.mint, OWNER, memo))
    accounts.set(prepared.mint, { owner: TOKEN_PROGRAM, parsed: { type: 'mint', info: { decimals: 6, supply: '5', mintAuthority: OWNER } } })
    const field = (value: string, size: number) => {
      const bytes = Buffer.alloc(4 + size)
      bytes.writeUInt32LE(size, 0)
      bytes.write(value, 4, 'utf8')
      return bytes
    }
    const data = Buffer.concat([Buffer.of(4), Buffer.alloc(32, 1), new PublicKey(prepared.mint).toBuffer(), field('Chain Name', 32), field('CHN', 10), field('https://x.test/m', 200)])
    accounts.set(metadataAddress(prepared.mint), { owner: TOKEN_METADATA_PROGRAM, base64: data.toString('base64') })
    const outcome = await verifyLaunch(context(), { mint: prepared.mint, signature })
    expect(outcome).toMatchObject({ status: 'VERIFIED', token: { name: 'Chain Name', symbol: 'CHN', uri: 'https://x.test/m', mintAuthority: OWNER } })
  })

  it('refuses launches for unregistered descendants', async () => {
    const { deployment } = await createDeployment(context(), { ...defaultConfig('hybrid'), tier: 'testnet' }, 'idem-key-unregistered')
    await expect(prepareSpl(context(), { deploymentId: deployment.id, wallet: OWNER, spec })).rejects.toMatchObject({ code: 'NOT_REGISTERED' })
  })
})

describe('devnet faucet', () => {
  it('is unavailable on mainnet and without a key', () => {
    vi.stubEnv('QFORK_FAUCET_KEYPAIR', '')
    expect(faucetAvailability(context()).available).toBe(false)
    vi.stubEnv('QFORK_FAUCET_KEYPAIR', JSON.stringify([...faucetAuthority.secretKey]))
    vi.stubEnv('SOLANA_NETWORK', 'mainnet-beta')
    expect(context().env.faucetKey).toBeNull()
    expect(faucetAvailability(context()).available).toBe(false)
  })

  it('mints test QFORK with a valid authority signature, once per wallet per day', async () => {
    const wallet = Keypair.generate().publicKey.toBase58()
    const result = await dripFaucet(context(), wallet)
    expect(result.amount).toBe(FAUCET_QFORK)
    expect(sent).toHaveLength(1)
    const tx = Transaction.from(Buffer.from(sent[0], 'base64'))
    expect(tx.feePayer?.toBase58()).toBe(faucetAuthority.publicKey.toBase58())
    expect(tx.verifySignatures()).toBe(true)
    const mintTo = tx.instructions.find((ix) => ix.programId.toBase58() === TOKEN_2022_PROGRAM && ix.data[0] === 14)
    expect(Buffer.from(mintTo!.data).readBigUInt64LE(1)).toBe(BigInt(FAUCET_QFORK) * 10n ** 6n)
    await expect(dripFaucet(context(), wallet)).rejects.toMatchObject({ code: 'FAUCET_COOLDOWN' })
  })

  it('limits claims per IP and releases the wallet when misconfigured', async () => {
    for (let index = 0; index < 3; index += 1) await dripFaucet(context('10.0.0.9'), Keypair.generate().publicKey.toBase58())
    await expect(dripFaucet(context('10.0.0.9'), Keypair.generate().publicKey.toBase58())).rejects.toMatchObject({ code: 'FAUCET_COOLDOWN' })

    accounts.set(QFORK, { owner: TOKEN_2022_PROGRAM, parsed: { type: 'mint', info: { decimals: 6, mintAuthority: STRANGER } } })
    const wallet = Keypair.generate().publicKey.toBase58()
    await expect(dripFaucet(context('10.0.0.2'), wallet)).rejects.toMatchObject({ code: 'FAUCET_MISCONFIGURED' })
    expect(await store.get(keys.faucet(`w:${wallet}`))).toBeNull()
  })
})
