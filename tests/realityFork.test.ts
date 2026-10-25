import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, type Hex, http, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type AnvilMetadata,
  checkForkIdentity,
  compareRuns,
  FORK_SPEC,
  forkCommands,
  isLoopbackRpc,
  parseScenario,
  type Rpc,
  runOnFork,
  type Scenario,
  stateChanges,
} from '../src/protocol/realityFork'
import { registerCalldata } from '../src/protocol/registry'

const DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const ARTIFACT = new URL('../contracts/out/QForkRegistry.sol/QForkRegistry.json', import.meta.url)
const hasAnvil = spawnSync('anvil', ['--version']).status === 0
const REVERT_CODE = '0x60006000fd'
const USER = '0x000000000000000000000000000000000000beef'

describe('scenario format', () => {
  const valid = { spec: FORK_SPEC, source: 'base-sepolia', block: 100, modifications: [], calls: [{ from: '0x000000000000000000000000000000000000dEaD', to: '0x4200000000000000000000000000000000000006' }] }

  it('fills defaults and normalises addresses and words', () => {
    const parsed = parseScenario({ ...valid, modifications: [{ kind: 'storage', address: '0x4200000000000000000000000000000000000006', slot: '0x1', value: '0xff' }] })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.scenario.calls[0]).toMatchObject({ from: '0x000000000000000000000000000000000000dead', data: '0x', valueWei: '0', gas: 3_000_000 })
    expect(parsed.scenario.modifications[0]).toMatchObject({ slot: `0x${'0'.repeat(63)}1`, value: `0x${'0'.repeat(62)}ff` })
    expect(parsed.scenario.fundSenders).toBe(true)
  })

  it('rejects malformed input', () => {
    expect(parseScenario({ ...valid, calls: [] }).ok).toBe(false)
    expect(parseScenario({ ...valid, calls: [{ ...valid.calls[0], data: '0x123' }] }).ok).toBe(false)
    expect(parseScenario({ ...valid, modifications: [{ kind: 'balance', address: '0x00', wei: '1' }] }).ok).toBe(false)
    expect(parseScenario({ ...valid, modifications: [{ kind: 'code', address: valid.calls[0].to, code: `0x${'00'.repeat(24_577)}` }] }).ok).toBe(false)
    expect(parseScenario({ ...valid, extra: 1 }).ok).toBe(false)
  })

  it('only treats loopback HTTP endpoints as forks', () => {
    expect(isLoopbackRpc('http://127.0.0.1:8545')).toBe(true)
    expect(isLoopbackRpc('http://localhost:8546/')).toBe(true)
    expect(isLoopbackRpc('https://sepolia.base.org')).toBe(false)
    expect(isLoopbackRpc('http://127.0.0.1.evil.example:8545')).toBe(false)
    expect(isLoopbackRpc('http://user@127.0.0.1:8545')).toBe(false)
    expect(isLoopbackRpc('http://127.0.0.1:8545/rpc?x')).toBe(false)
  })

  it('generates two forks of the same block', () => {
    const commands = forkCommands('base-sepolia', 1234)
    expect(commands.original).toBe('anvil --fork-url https://sepolia.base.org --fork-block-number 1234 --port 8545')
    expect(commands.modified).toContain('--port 8546')
  })
})

describe('fork identity', () => {
  const metadata = (fork: AnvilMetadata['forkedNetwork']): AnvilMetadata => ({ clientVersion: 'anvil/v1.7.1', chainId: 84532, instanceId: '0x01', forkedNetwork: fork })
  const hash = `0x${'ab'.repeat(32)}` as Hex

  it('accepts a fork of the expected block with the real hash', () => {
    expect(checkForkIdentity(metadata({ chainId: 84532, forkBlockNumber: 7, forkBlockHash: hash }), { source: 'base-sepolia', block: 7, blockHash: hash })).toEqual([])
  })

  it('names each mismatch', () => {
    expect(checkForkIdentity({ ...metadata(null), clientVersion: 'Geth/v1' }, { source: 'base', block: 7, blockHash: hash })[0].code).toBe('NOT_ANVIL')
    expect(checkForkIdentity(metadata(null), { source: 'base', block: 7, blockHash: hash })[0].code).toBe('NOT_A_FORK')
    const codes = checkForkIdentity(metadata({ chainId: 84532, forkBlockNumber: 8, forkBlockHash: hash }), { source: 'base', block: 7, blockHash: hash }).map((issue) => issue.code)
    expect(codes).toEqual(['WRONG_CHAIN', 'WRONG_BLOCK'])
    expect(checkForkIdentity(metadata({ chainId: 84532, forkBlockNumber: 7, forkBlockHash: hash }), { source: 'base-sepolia', block: 7, blockHash: `0x${'cd'.repeat(32)}` })[0].code).toBe('HASH_MISMATCH')
  })
})

describe('state diff', () => {
  it('reads set, changed and cleared slots and skips unchanged fields', () => {
    const slot = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex
    const rows = stateChanges({
      pre: { '0xAA': { balance: '0x0', code: '0x60', storage: { [slot(0)]: slot(9) } }, '0xbb': { balance: '0x10' } },
      post: { '0xAA': { storage: { [slot(1)]: slot(5) } }, '0xbb': { balance: '0x0f', nonce: 1 } },
    })
    expect(rows).toEqual([
      { address: '0xaa', field: `storage:${slot(0)}`, before: slot(9), after: null },
      { address: '0xaa', field: `storage:${slot(1)}`, before: null, after: slot(5) },
      { address: '0xbb', field: 'balance', before: '16', after: '15' },
      { address: '0xbb', field: 'nonce', before: '0', after: '1' },
    ])
  })
})

const nodes: ChildProcess[] = []
async function startAnvil(args: string[], port: number) {
  const node = spawn('anvil', [...args, '--port', String(port), '--silent'], { stdio: 'ignore' })
  nodes.push(node)
  const url = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) })
      .then((response) => response.ok)
      .catch(() => false)
    if (ready) return url
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`anvil did not start on ${port}`)
}

function rpcFor(url: string): Rpc {
  return async (method, params = []) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const body = (await response.json()) as { result?: unknown; error?: { message: string } }
    if (body.error) throw new Error(`${method}: ${body.error.message}`)
    return body.result
  }
}

afterAll(() => {
  for (const node of nodes) node.kill()
})

describe.skipIf(!hasAnvil || !existsSync(ARTIFACT))('two real Anvil forks of one block', () => {
  let source: string
  let registry: Hex
  let block: number
  let blockHash: Hex
  let original: Rpc
  let modified: Rpc
  let scenario: Scenario

  beforeAll(async () => {
    source = await startAnvil(['--chain-id', '84532'], 18621)
    const account = privateKeyToAccount(DEV_KEY)
    const chain = { id: 84532, name: 'source', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [source] } } } as const
    const wallet = createWalletClient({ account, chain, transport: http(source) })
    const client = createPublicClient({ chain, transport: http(source) })
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { bytecode: { object: Hex } }
    const deployTx = await wallet.sendTransaction({ data: artifact.bytecode.object })
    registry = (await client.waitForTransactionReceipt({ hash: deployTx })).contractAddress!
    const head = await client.getBlock()
    block = Number(head.number)
    blockHash = head.hash!

    original = rpcFor(await startAnvil(['--fork-url', source, '--fork-block-number', String(block)], 18622))
    modified = rpcFor(await startAnvil(['--fork-url', source, '--fork-block-number', String(block)], 18623))

    const parsed = parseScenario({
      spec: FORK_SPEC,
      source: 'base-sepolia',
      block,
      modifications: [{ kind: 'code', address: registry, code: REVERT_CODE }],
      calls: [{ label: 'Register a hash', from: USER, to: registry, data: registerCalldata(keccak256(toBytes('reality-fork')), 1, '') }],
    })
    if (!parsed.ok) throw new Error(parsed.issues.join('; '))
    scenario = parsed.scenario
  }, 30_000)

  it('proves both nodes fork the source at the expected block', async () => {
    for (const rpc of [original, modified]) {
      const metadata = (await rpc('anvil_metadata')) as AnvilMetadata
      expect(checkForkIdentity(metadata, { source: 'base-sepolia', block, blockHash })).toEqual([])
    }
    const wrong = (await original('anvil_metadata')) as AnvilMetadata
    expect(checkForkIdentity(wrong, { source: 'base-sepolia', block, blockHash: `0x${'00'.repeat(32)}` })[0].code).toBe('HASH_MISMATCH')
  })

  it('runs the same call on both forks and finds the difference', async () => {
    const a = await runOnFork(original, scenario, false)
    const b = await runOnFork(modified, scenario, true)

    expect(a.forkBlock).toBe(block)
    expect(a.outcomes[0].status).toBe('success')
    expect(a.outcomes[0].logs).toHaveLength(1)
    expect(a.outcomes[0].changes.some((change) => change.address === registry.toLowerCase() && change.field.startsWith('storage:'))).toBe(true)

    expect(b.modifications).toBe(1)
    expect(b.outcomes[0].status).toBe('reverted')
    expect(b.outcomes[0].logs).toHaveLength(0)
    expect(b.outcomes[0].changes.some((change) => change.address === registry.toLowerCase())).toBe(false)

    const rows = compareRuns(a, b)
    expect(rows.find((row) => row.aspect === 'Status')).toMatchObject({ original: 'success', modified: 'reverted', differs: true })
    expect(rows.find((row) => row.aspect === 'Events')).toMatchObject({ original: '1', modified: '0', differs: true })
  })

  it('returns each fork to its starting state, so reruns match', async () => {
    const first = await runOnFork(original, scenario, false)
    const second = await runOnFork(original, scenario, false)
    expect(compareRuns(first, second).filter((row) => row.differs)).toEqual([])
    const code = (await modified('eth_getCode', [registry, 'latest'])) as Hex
    expect(code).not.toBe(REVERT_CODE)
    expect(code.length).toBeGreaterThan(100)
  })

  it('reports no differences between two unmodified forks', async () => {
    const a = await runOnFork(original, scenario, false)
    const b = await runOnFork(modified, scenario, false)
    expect(compareRuns(a, b).filter((row) => row.differs)).toEqual([])
  })

  it('never writes to the network it forked', async () => {
    const before = await rpcFor(source)('eth_blockNumber')
    await runOnFork(modified, scenario, true)
    expect(await rpcFor(source)('eth_blockNumber')).toBe(before)
    expect(await rpcFor(source)('eth_getTransactionCount', [USER, 'latest'])).toBe('0x0')
  })
})
