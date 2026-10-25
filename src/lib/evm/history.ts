import { type Hex } from 'viem'
import { BASE_PUBLIC_RPC, type BaseNetwork } from '../../protocol/base'
import { type HistoricalLog, isTxHash, MAX_REPLAY, rawTransaction, type ReplayItem, type RpcTransaction, tokenTransfers, type Transfer } from '../../protocol/timeMachine'

export interface LoadedHistory {
  source: BaseNetwork
  hash: Hex
  blockNumber: number
  blockHash: Hex
  parentBlock: number
  parentHash: Hex
  timestamp: number
  baseFee: bigint
  index: number
  from: Hex
  to: Hex | null
  value: bigint
  input: Hex
  gas: bigint
  gasUsed: bigint
  status: 'success' | 'reverted'
  logs: HistoricalLog[]
  transfers: Transfer[]
  items: ReplayItem[]
}

interface RpcBlock {
  number: Hex
  hash: Hex
  parentHash: Hex
  timestamp: Hex
  baseFeePerGas?: Hex
  transactions: RpcTransaction[]
}

async function read(source: BaseNetwork, method: string, params: unknown[]) {
  let response: Response
  try {
    response = await fetch(BASE_PUBLIC_RPC[source], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  } catch {
    throw new Error(`Could not reach ${source === 'base' ? 'Base' : 'Base Sepolia'}.`)
  }
  const body = (await response.json().catch(() => ({}))) as { result?: unknown; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? 'The network rejected the request.')
  return body.result
}

/** Reads one transaction, its receipt, and its block from Base's public endpoint. No fork calls. */
export async function loadHistory(source: BaseNetwork, hash: string): Promise<LoadedHistory> {
  if (!isTxHash(hash)) throw new Error('A transaction hash is 0x followed by 64 hex characters.')
  const tx = (await read(source, 'eth_getTransactionByHash', [hash])) as (RpcTransaction & { blockNumber: Hex | null; transactionIndex: Hex | null }) | null
  if (!tx) throw new Error('No transaction with that hash on this network.')
  if (!tx.blockNumber || tx.transactionIndex == null) throw new Error('That transaction is still pending. Replay starts once it is in a block.')
  const [receipt, block] = (await Promise.all([
    read(source, 'eth_getTransactionReceipt', [hash]),
    read(source, 'eth_getBlockByNumber', [tx.blockNumber, true]),
  ])) as [{ status: Hex; gasUsed: Hex; logs: HistoricalLog[] }, RpcBlock]
  const index = Number(BigInt(tx.transactionIndex))
  if (block.transactions.length <= index) throw new Error('The block does not contain this transaction.')
  if (index + 1 > MAX_REPLAY) throw new Error(`This transaction is number ${index + 1} in its block. Replay stops at ${MAX_REPLAY}.`)
  const chainId = source === 'base' ? 8453 : 84532
  const items = block.transactions.slice(0, index + 1).map((item) => rawTransaction(item, chainId))
  const logs = receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data }))
  return {
    source,
    hash: tx.hash,
    blockNumber: Number(BigInt(block.number)),
    blockHash: block.hash,
    parentBlock: Number(BigInt(block.number)) - 1,
    parentHash: block.parentHash,
    timestamp: Number(BigInt(block.timestamp)),
    baseFee: BigInt(block.baseFeePerGas ?? '0x0'),
    index,
    from: tx.from,
    to: tx.to,
    value: BigInt(tx.value),
    input: tx.input,
    gas: BigInt(tx.gas),
    gasUsed: BigInt(receipt.gasUsed),
    status: receipt.status === '0x1' ? 'success' : 'reverted',
    logs,
    transfers: tokenTransfers(logs),
    items,
  }
}
