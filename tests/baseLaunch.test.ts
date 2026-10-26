import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { type Hex, getAddress } from 'viem'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDeployment, submitBurn } from '../api/_lib/deployments'
import { prepareClanker, verifyClanker } from '../api/_lib/tokens'
import { serverEnv } from '../api/_lib/env'
import type { Context } from '../api/_lib/http'
import { createLogger } from '../api/_lib/log'
import { keys, memoryStore, type Store } from '../api/_lib/store'
import { BURN_ADDRESS, burnCalldata, burnTag } from '../src/protocol/base'
import { CLANKER_FACTORY, CLANKER_SUPPLY_RAW } from '../src/protocol/clanker'
import { defaultConfig } from '../src/protocol/descendant'
import { toBaseUnits } from '../src/protocol/pricing'

/**
 * Launch rehearsal: the real registration pipeline against a fork of Base mainnet and the real
 * $QFORK token. Skips when Anvil or the Base RPC is unavailable.
 */
const hasAnvil = spawnSync('anvil', ['--version']).status === 0
const SOURCE = 'https://mainnet.base.org'
/** $QFORK on Base, launched on o1. It has no burn(), so burns go to BURN_ADDRESS. */
const TOKEN = getAddress('0x183439fe5442bab6df9d3174baee70da900e6301')
const QFORK_SUPPLY_RAW = 10n ** 27n
/** Uniswap v4 PoolManager on Base: holds the pool's $QFORK. */
const BURNER = getAddress('0x498581fF718922c3f8e6A244956aF099B2652b2b')
const PORT = 18741
const TOTAL_SUPPLY = '0x18160ddd'
const balanceOf = (owner: Hex) => `0x70a08231${owner.slice(2).toLowerCase().padStart(64, '0')}`

let node: ChildProcess | null = null
let url = ''

async function call(target: string, method: string, params: unknown[] = []) {
  const response = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const body = (await response.json()) as { result?: unknown; error?: { message: string } }
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return body.result
}

async function receipt(hash: Hex) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = (await call(url, 'eth_getTransactionReceipt', [hash])) as { status: Hex } | null
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`no receipt for ${hash}`)
}

async function reachable() {
  try {
    return ((await call(SOURCE, 'eth_getCode', [TOKEN, 'latest'])) as string).length > 2
  } catch {
    return false
  }
}

beforeAll(async () => {
  if (!hasAnvil || !(await reachable())) return
  node = spawn('anvil', ['--fork-url', SOURCE, '--chain-id', '8453', '--network', 'optimism', '--compute-units-per-second', '100', '--retries', '8', '--port', String(PORT), '--silent'], { stdio: 'ignore' })
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await call(`http://127.0.0.1:${PORT}`, 'eth_chainId').then(() => true, () => false)) {
      url = `http://127.0.0.1:${PORT}`
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}, 30_000)

afterAll(() => {
  node?.kill()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

let store: Store | undefined
let registered = ''
const context = (): Context => ({
  request: new Request('http://test.local/api'),
  url: new URL('http://test.local/api'),
  env: serverEnv(),
  store: store as Store,
  log: createLogger({}, 'error'),
  correlationId: 'launch-rehearsal',
  ip: '127.0.0.1',
})

function goLive() {
  vi.stubEnv('BASE_NETWORK', 'base')
  vi.stubEnv('BASE_RPC_URL', url)
  vi.stubEnv('QFORK_BASE_TOKEN', TOKEN)
  vi.stubEnv('BASE_TOKEN_STATUS', 'LIVE')
  vi.stubEnv('ENABLE_BASE_DEPLOYMENTS', 'true')
  store ??= memoryStore(true)
}

describe('Base mainnet launch rehearsal (fork)', () => {
  it('registers a mainnet descendant from a real $QFORK burn to 0x…dEaD, once finalized', async (test) => {
    if (!url) return test.skip()
    goLive()
    const read = async (data: string) => BigInt((await call(url, 'eth_call', [{ to: TOKEN, data }, 'latest'])) as Hex)
    expect(await read(TOTAL_SUPPLY)).toBe(QFORK_SUPPLY_RAW)
    const deadBefore = await read(balanceOf(BURN_ADDRESS))

    const { deployment } = await createDeployment(context(), { ...defaultConfig(), tier: 'mainnet' }, 'launch-rehearsal-key-1', 'base')
    expect(deployment.burn).toMatchObject({ chain: 'base', network: 'base', mint: TOKEN })
    const amountRaw = toBaseUnits(deployment.burn.required, 18)

    await call(url, 'anvil_impersonateAccount', [BURNER])
    await call(url, 'anvil_setBalance', [BURNER, '0xde0b6b3a7640000'])
    const hash = (await call(url, 'eth_sendTransaction', [{ from: BURNER, to: TOKEN, data: burnCalldata(amountRaw, burnTag(deployment.burn.memo)) }])) as Hex
    const mined = await receipt(hash)
    expect(mined.status).toBe('0x1')
    expect((await read(balanceOf(BURN_ADDRESS))) - deadBefore).toBe(amountRaw)
    expect(await read(TOTAL_SUPPLY)).toBe(QFORK_SUPPLY_RAW)

    expect((await submitBurn(context(), deployment.id, hash)).status).toBe('PENDING')
    await call(url, 'anvil_mine', ['0x80'])
    const outcome = await submitBurn(context(), deployment.id, hash)
    expect(outcome.status).toBe('VERIFIED')
    if (outcome.status !== 'VERIFIED') return
    expect(outcome.deployment.state).toBe('REGISTERED')
    expect(outcome.receipt).toMatchObject({ chain: 'base', network: 'base', mint: TOKEN, amountRaw: amountRaw.toString(), ancestor: 'base' })
    expect(getAddress(outcome.receipt.wallet)).toBe(BURNER)
      expect(await store?.get(keys.burnedWhole('base'))).toBe(String(deployment.burn.required))
    registered = deployment.id
  }, 90_000)

  it('launches a descendant token through the real Clanker v4 factory and verifies it', async (test) => {
    if (!url || !registered) return test.skip()
    goLive()
    vi.stubEnv('ENABLE_CLANKER_LAUNCH', 'true')
    const { prepared } = await prepareClanker(context(), { deploymentId: registered, wallet: BURNER, spec: { name: 'Lattice Coin', symbol: 'LAT', description: '' } })
    expect(prepared).toMatchObject({ cluster: 'base', chainId: 8453, to: CLANKER_FACTORY })

    const hash = (await call(url, 'eth_sendTransaction', [{ from: BURNER, to: prepared.to, data: prepared.data }])) as Hex
    expect((await receipt(hash)).status).toBe('0x1')
    expect(await verifyClanker(context(), { launchId: prepared.launchId, hash })).toEqual({ status: 'PENDING' })
    await call(url, 'anvil_mine', ['0x80'])
    const outcome = await verifyClanker(context(), { launchId: prepared.launchId, hash })
    expect(outcome).toMatchObject({ status: 'VERIFIED', token: { kind: 'clanker', cluster: 'base', decimals: 18, supplyRaw: CLANKER_SUPPLY_RAW.toString() } })
    if (outcome.status !== 'VERIFIED') return
    expect(getAddress(outcome.token.creator)).toBe(BURNER)
    const supply = BigInt((await call(url, 'eth_call', [{ to: outcome.token.mint, data: TOTAL_SUPPLY }, 'latest'])) as Hex)
    expect(supply).toBe(CLANKER_SUPPLY_RAW)
    expect(await store?.lrange(keys.tokensOf(registered), 0, -1)).toEqual([outcome.token.mint])
  }, 90_000)

  it('reports the live token from the chain on /api/token', async (test) => {
    if (!url) return test.skip()
    goLive()
    const { GET } = await import('../api/token')
    const body = (await (await GET(new Request('http://test.local/api/token'))).json()) as { base: Record<string, unknown> }
    expect(body.base).toMatchObject({ status: 'LIVE', network: 'base', token: TOKEN, decimals: 18, error: null })
    expect(BigInt(body.base.supplyRaw as string)).toBe(QFORK_SUPPLY_RAW)
  }, 30_000)
})
