import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { afterAll, describe, expect, it } from 'vitest'
import { BASE_PUBLIC_RPC } from '../src/protocol/base'
import { compareToChain, rawTransaction, replayHistory, timeMachineCommand, tokenTransfers, type RpcTransaction } from '../src/protocol/timeMachine'
import { type Rpc, isLoopbackRpc } from '../src/protocol/realityFork'

const hasAnvil = spawnSync('anvil', ['--version']).status === 0
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const BOX = '0x00000000000000000000000000000000000000bb'
const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}` as Hex

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

describe('replay format', () => {
  it('forks the parent block, in optimism mode, on its own port', () => {
    expect(timeMachineCommand('base-sepolia', 49873285)).toBe('anvil --fork-url https://sepolia.base.org --fork-block-number 49873285 --chain-id 84532 --network optimism --hardfork isthmus --port 8547')
    expect(isLoopbackRpc(`http://127.0.0.1:8547`)).toBe(true)
  })

  it('reads ERC-20 and ERC-721 transfers and ignores other logs', () => {
    const token = '0x1111111111111111111111111111111111111111' as Hex
    const from = `0x${'ab'.repeat(32)}` as Hex
    const to = `0x${'cd'.repeat(32)}` as Hex
    const transfers = tokenTransfers([
      { address: token, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', from, to], data: word(5n) },
      { address: token, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', from, to, word(9n)], data: '0x' },
      { address: token, topics: ['0x0000000000000000000000000000000000000000000000000000000000000001'], data: '0x' },
    ])
    expect(transfers).toEqual([
      { kind: 'erc20', token, from: `0x${'ab'.repeat(20)}`, to: `0x${'cd'.repeat(20)}`, amount: '5' },
      { kind: 'erc721', token, from: `0x${'ab'.repeat(20)}`, to: `0x${'cd'.repeat(20)}`, amount: '9' },
    ])
  })

  it('refuses a transaction type whose bytes the RPC does not carry', () => {
    expect(() => rawTransaction({ hash: `0x${'11'.repeat(32)}`, type: '0x3', nonce: '0x0', from: BOX, to: BOX, value: '0x0', input: '0x', gas: '0x5208' }, 84532)).toThrow(/blob/i)
  })

  it('treats matching status and gas as a match, and says when the block number moved', () => {
    const chain = { status: 'success' as const, gasUsed: 21_000n, logs: [] }
    const replay = { status: 'success' as const, gasUsed: 21_000n, logs: [], label: '', txHash: '0x' as Hex, output: '0x' as Hex, error: null, frames: [], changes: [] }
    expect(compareToChain(chain, replay, 11, 10).match).toBe(true)
    expect(compareToChain(chain, replay, 11, 10).rows.find((row) => row.aspect === 'Block number')?.differs).toBe(true)
    expect(compareToChain({ ...chain, gasUsed: 21_001n }, replay, 10, 10).match).toBe(false)
  })
})

describe.skipIf(!hasAnvil)('ordered replay on a local chain', () => {
  it('reproduces the middle transaction of a block, and a calldata edit changes the result', async () => {
    const source = await startAnvil(['--chain-id', '84532', '--base-fee', '1000000000'], 18721)
    const rpc = rpcFor(source)
    await rpc('anvil_setCode', [BOX, '0x60003560005500'])
    const account = privateKeyToAccount(KEY)
    const chain = { id: 84532, name: 'source', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [source] } } } as const
    const wallet = createWalletClient({ account, chain, transport: http(source) })
    await rpc('evm_setAutomine', [false])
    await rpc('evm_setNextBlockTimestamp', [word(2_000_000_000n)])
    await rpc('anvil_setNextBlockBaseFeePerGas', ['0x3b9aca00'])
    const hashes: Hex[] = []
    for (const value of [1n, 2n, 3n]) hashes.push(await wallet.sendTransaction({ to: BOX, data: word(value), maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1n }))
    await rpc('evm_mine')
    const original = (await rpc('eth_getTransactionReceipt', [hashes[1]])) as { gasUsed: Hex; status: Hex; blockNumber: Hex; logs: [] }
    const block = (await rpc('eth_getBlockByNumber', [original.blockNumber, true])) as { timestamp: Hex; baseFeePerGas: Hex; transactions: RpcTransaction[] }
    const items = block.transactions.slice(0, 2).map((tx) => rawTransaction(tx, 84532))
    const fork = rpcFor(await startAnvil(['--chain-id', '84532', '--fork-url', source, '--fork-block-number', String(Number(BigInt(original.blockNumber)) - 1)], 18722))

    const report = await replayHistory(fork, items, { timestamp: BigInt(block.timestamp), baseFee: BigInt(block.baseFeePerGas) }, Number(BigInt(original.blockNumber)), { data: word(9n), state: [] })
    const fidelity = compareToChain({ status: 'success', gasUsed: BigInt(original.gasUsed), logs: [] }, report.faithful.outcome, report.faithful.blockNumber, Number(BigInt(original.blockNumber)))
    expect(fidelity.match).toBe(true)
    expect(report.historicalBlock).toBe(true)
    expect(report.faithful.outcome.gasUsed).toBe(BigInt(original.gasUsed))
    const slot = (run: typeof report.faithful) => run.outcome.changes.find((change) => change.field.startsWith('storage:'))
    expect(slot(report.faithful)?.after).toBe(word(2n))
    expect(slot(report.modified!)?.after).toBe(word(9n))
    expect(BigInt((await fork('eth_getStorageAt', [BOX, '0x0', 'latest'])) as Hex)).toBe(0n)
  }, 30_000)
})

describe.skipIf(!hasAnvil)('ordered replay of a real Base Sepolia block', () => {
  it('matches the gas, status and logs of a transaction that follows two deposits', async () => {
    const blockNumber = 49873286
    const index = 2
    const read = async (method: string, params: unknown[]) => {
      const response = await fetch(BASE_PUBLIC_RPC['base-sepolia'], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      const body = (await response.json()) as { result?: unknown; error?: { message: string } }
      if (body.error || body.result == null) throw new Error(body.error?.message ?? 'empty')
      return body.result
    }
    let block: { number: Hex; timestamp: Hex; baseFeePerGas: Hex; transactions: RpcTransaction[] }
    try {
      block = (await read('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, true])) as typeof block
    } catch {
      return
    }
    const target = block.transactions[index]
    const receipt = (await read('eth_getTransactionReceipt', [target.hash])) as { status: Hex; gasUsed: Hex; logs: { address: Hex; topics: Hex[]; data: Hex }[] }
    const items = block.transactions.slice(0, index + 1).map((tx) => rawTransaction(tx, 84532))
    const fork = rpcFor(await startAnvil(['--network', 'optimism', '--hardfork', 'isthmus', '--fork-url', BASE_PUBLIC_RPC['base-sepolia'], '--fork-block-number', String(blockNumber - 1)], 18723))
    const report = await replayHistory(fork, items, { timestamp: BigInt(block.timestamp), baseFee: BigInt(block.baseFeePerGas) }, blockNumber)
    const fidelity = compareToChain({ status: receipt.status === '0x1' ? 'success' : 'reverted', gasUsed: BigInt(receipt.gasUsed), logs: receipt.logs }, report.faithful.outcome, report.faithful.blockNumber, blockNumber)
    expect(fidelity.match).toBe(true)
    expect(report.historicalBlock).toBe(true)
    expect(report.faithful.outcome.txHash).toBe(target.hash)
  }, 60_000)
})
