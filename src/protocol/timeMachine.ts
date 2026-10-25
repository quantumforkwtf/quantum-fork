import { type Hex, keccak256, serializeTransaction } from 'viem'
import { serializeTransaction as serializeOp } from 'viem/op-stack'
import { BASE_CHAIN_ID, BASE_PUBLIC_RPC, type BaseNetwork } from './base.js'
import { type CallOutcome, inspectTransaction, type Modification, modificationCalls, type Rpc } from './realityFork.js'

/**
 * Time Machine replays one historical transaction on an Anvil fork of its parent block.
 * Forking the transaction's own block is the state after the whole block, so every
 * transaction before the target is resubmitted first, in order. Deposit transactions are
 * included: Base puts them at the front of every block, and skipping them is not the
 * pre-state. Nothing here is sent to Base.
 */

export const TIME_MACHINE_PORT = 8547
export const MAX_REPLAY = 500
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export interface RpcTransaction {
  hash: Hex
  type: Hex
  nonce: Hex
  from: Hex
  to: Hex | null
  value: Hex
  input: Hex
  gas: Hex
  gasPrice?: Hex
  maxFeePerGas?: Hex
  maxPriorityFeePerGas?: Hex
  accessList?: { address: Hex; storageKeys: Hex[] }[]
  chainId?: Hex
  v?: Hex
  r?: Hex
  s?: Hex
  yParity?: Hex
  sourceHash?: Hex
  mint?: Hex
}

export interface ReplayItem {
  hash: Hex
  raw: Hex
  kind: 'deposit' | 'transaction'
  from: Hex
  to: Hex | null
  nonce: bigint
  input: Hex
  value: bigint
  gas: bigint
  maxFeePerGas: bigint | null
  maxPriorityFeePerGas: bigint | null
}

export interface Transfer {
  kind: 'erc20' | 'erc721'
  token: Hex
  from: Hex
  to: Hex
  amount: string
}

export interface HistoricalLog {
  address: Hex
  topics: Hex[]
  data: Hex
}

export interface FidelityRow {
  aspect: string
  chain: string
  replay: string
  differs: boolean
}

const hex = (value: bigint) => `0x${value.toString(16)}` as Hex
const quantity = (value: Hex) => BigInt(value)
const addressOf = (topic: Hex) => `0x${topic.slice(-40)}`.toLowerCase() as Hex

export function isTxHash(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
}

/** The Anvil command that forks the parent block. The transaction's own block is already too late. */
export function timeMachineCommand(source: BaseNetwork, parentBlock: number) {
  const chainId = BASE_CHAIN_ID[source]
  return `anvil --fork-url ${BASE_PUBLIC_RPC[source]} --fork-block-number ${parentBlock} --chain-id ${chainId} --network optimism --hardfork isthmus --port ${TIME_MACHINE_PORT}`
}

/** Rebuilds the exact signed bytes. The hash must match the transaction on the chain. */
export function rawTransaction(tx: RpcTransaction, chainId: number): ReplayItem {
  const signature = { r: tx.r as Hex, s: tx.s as Hex, yParity: Number(tx.yParity ?? tx.v ?? 0) }
  const id = tx.chainId ? Number(quantity(tx.chainId)) : chainId
  let raw: Hex
  if (tx.type === '0x7e') {
    if (!tx.sourceHash) throw new Error('This deposit transaction has no source hash, so it cannot be replayed.')
    const candidates = [false, true].map((isSystemTx) => serializeOp({ type: 'deposit', sourceHash: tx.sourceHash as Hex, from: tx.from, to: tx.to, mint: tx.mint ? quantity(tx.mint) : 0n, value: quantity(tx.value), gas: quantity(tx.gas), isSystemTx, data: tx.input }))
    const matched = candidates.find((candidate) => keccak256(candidate) === tx.hash.toLowerCase())
    if (!matched) throw new Error(`Deposit ${tx.hash} does not match either deposit encoding, so it was not replayed.`)
    raw = matched
  } else if (tx.type === '0x2') {
    raw = serializeTransaction({ type: 'eip1559', chainId: id, nonce: Number(quantity(tx.nonce)), gas: quantity(tx.gas), maxFeePerGas: quantity(tx.maxFeePerGas ?? tx.gasPrice ?? '0x0'), maxPriorityFeePerGas: quantity(tx.maxPriorityFeePerGas ?? '0x0'), to: tx.to, value: quantity(tx.value), data: tx.input, accessList: tx.accessList }, signature)
  } else if (tx.type === '0x1') {
    raw = serializeTransaction({ type: 'eip2930', chainId: id, nonce: Number(quantity(tx.nonce)), gas: quantity(tx.gas), gasPrice: quantity(tx.gasPrice ?? '0x0'), to: tx.to, value: quantity(tx.value), data: tx.input, accessList: tx.accessList }, signature)
  } else if (tx.type === '0x0' || tx.type === '0x') {
    raw = serializeTransaction({ type: 'legacy', chainId: id, nonce: Number(quantity(tx.nonce)), gas: quantity(tx.gas), gasPrice: quantity(tx.gasPrice ?? '0x0'), to: tx.to, value: quantity(tx.value), data: tx.input }, { v: quantity(tx.v ?? '0x1b'), r: tx.r as Hex, s: tx.s as Hex })
  } else {
    throw new Error(`Transaction type ${tx.type} cannot be replayed. Blob and 7702 transactions need data this RPC does not return.`)
  }
  if (keccak256(raw) !== tx.hash.toLowerCase()) throw new Error(`Rebuilt bytes for ${tx.hash} hash to ${keccak256(raw)}. They were not replayed.`)
  return {
    hash: tx.hash.toLowerCase() as Hex,
    raw,
    kind: tx.type === '0x7e' ? 'deposit' : 'transaction',
    from: tx.from.toLowerCase() as Hex,
    to: tx.to ? (tx.to.toLowerCase() as Hex) : null,
    nonce: quantity(tx.nonce),
    input: tx.input.toLowerCase() as Hex,
    value: quantity(tx.value),
    gas: quantity(tx.gas),
    maxFeePerGas: tx.maxFeePerGas ? quantity(tx.maxFeePerGas) : tx.gasPrice ? quantity(tx.gasPrice) : null,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? quantity(tx.maxPriorityFeePerGas) : null,
  }
}

export function tokenTransfers(logs: HistoricalLog[]): Transfer[] {
  const transfers: Transfer[] = []
  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue
    if (log.topics.length === 3 && log.data.length === 66) transfers.push({ kind: 'erc20', token: log.address.toLowerCase() as Hex, from: addressOf(log.topics[1]), to: addressOf(log.topics[2]), amount: BigInt(log.data).toString() })
    else if (log.topics.length === 4) transfers.push({ kind: 'erc721', token: log.address.toLowerCase() as Hex, from: addressOf(log.topics[1]), to: addressOf(log.topics[2]), amount: BigInt(log.topics[3]).toString() })
  }
  return transfers
}

export interface SimulationEdit {
  data?: Hex
  value?: bigint
  gas?: bigint
  state: Modification[]
}

export interface ReplayRun {
  outcome: CallOutcome
  blockNumber: number
}

export interface ReplayReport {
  faithful: ReplayRun
  modified: ReplayRun | null
  /** True when the replay mined the target in the historical block number. */
  historicalBlock: boolean
}

interface MineEnv {
  timestamp: bigint
  baseFee: bigint
}

async function pending(rpc: Rpc) {
  const pool = (await rpc('txpool_content', []).catch(() => null)) as { pending?: Record<string, Record<string, { hash: Hex }>> } | null
  const hashes = new Set<Hex>()
  for (const byNonce of Object.values(pool?.pending ?? {})) for (const tx of Object.values(byNonce)) hashes.add(tx.hash.toLowerCase() as Hex)
  return hashes
}

function miner(rpc: Rpc, env: MineEnv) {
  let blocks = 0
  return async () => {
    // The first replayed block keeps the historical timestamp. Later blocks move one
    // second forward, because a chain rejects a block stamped at its parent's time.
    await rpc('evm_setNextBlockTimestamp', [hex(env.timestamp + BigInt(blocks))])
    await rpc('anvil_setNextBlockBaseFeePerGas', [hex(env.baseFee)])
    await rpc('evm_mine')
    blocks += 1
  }
}

/** Submits the block's transactions in order, then mines them. Deposits share one block. */
async function submit(rpc: Rpc, items: ReplayItem[], env: MineEnv, replaceLast?: (flush: () => Promise<void>) => Promise<Hex>) {
  const mineBlock = miner(rpc, env)
  if (items[0]?.kind === 'deposit') {
    for (let attempt = 0; attempt < 15 && !(await pending(rpc)).has(items[0].hash); attempt++) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const queued = await pending(rpc)
  const list = replaceLast ? items.slice(0, -1) : items
  for (const item of list) {
    // Anvil gives every deposit from the Base system address the same pooled nonce.
    // Pinning the nonce to the deposit's own nonce lets the whole block stay together.
    if (item.kind === 'deposit' && !queued.has(item.hash)) await rpc('anvil_setNonce', [item.from, hex(item.nonce)])
    if (!queued.has(item.hash)) {
      let sent: Hex
      try {
        sent = (await rpc('eth_sendRawTransaction', [item.raw])) as Hex
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'The transaction was rejected.'
        if (/replacement transaction underpriced|already imported/i.test(message)) {
          await rpc('anvil_setNonce', [item.from, hex(item.nonce + 1n)])
          try {
            sent = (await rpc('eth_sendRawTransaction', [item.raw])) as Hex
          } catch {
            // Anvil may insert this deposit itself when the block is mined. The receipt
            // comparison below is what decides whether the replay still matches history.
            sent = item.hash
          }
        } else throw new Error(`Replaying ${item.hash} failed: ${message}`)
      }
      if (sent.toLowerCase() !== item.hash) throw new Error(`Anvil accepted ${item.hash} as ${sent}. The replay stopped rather than follow a different transaction.`)
      queued.add(item.hash)
    }
  }
  const target = items[items.length - 1]
  const flushQueued = async () => {
    if ((await pending(rpc)).size) await mineBlock()
  }
  const targetHash = replaceLast ? await replaceLast(flushQueued) : target.hash
  await mineBlock()
  const receipt = (await rpc('eth_getTransactionReceipt', [targetHash])) as { blockNumber: Hex } | null
  if (!receipt) throw new Error(`Anvil mined the block but ${targetHash} was not in it.`)
  return { hash: targetHash, blockNumber: Number(quantity(receipt.blockNumber)) }
}

async function withFork<T>(rpc: Rpc, run: () => Promise<T>) {
  const snapshot = (await rpc('evm_snapshot')) as Hex
  await rpc('evm_setAutomine', [false])
  try {
    return await run()
  } finally {
    await rpc('evm_setAutomine', [true]).catch(() => undefined)
    await rpc('evm_revert', [snapshot]).catch(() => undefined)
  }
}

/**
 * Replays the prefix and the target, checks nothing by itself, and reverts the fork.
 * `edit` replaces the target with an impersonated transaction after the same prefix.
 */
export async function replayHistory(rpc: Rpc, items: ReplayItem[], env: MineEnv, historicalBlock: number, edit?: SimulationEdit): Promise<ReplayReport> {
  if (!items.length) throw new Error('There is no transaction to replay.')
  if (items.length > MAX_REPLAY) throw new Error(`This transaction sits behind ${items.length - 1} others. Replay stops at ${MAX_REPLAY} so a busy block cannot lock the page.`)
  const faithful = await withFork(rpc, async () => {
    const mined = await submit(rpc, items, env)
    return { outcome: await inspectTransaction(rpc, mined.hash, 'Historical'), blockNumber: mined.blockNumber }
  })
  let modified: ReplayRun | null = null
  if (edit) {
    const target = items[items.length - 1]
    modified = await withFork(rpc, async () => {
      const mined = await submit(rpc, items, env, async (flush) => {
        if (target.kind === 'deposit') throw new Error('Deposit transactions are created by the Base bridge. Replay can include them, and the edit has to be on a later user transaction.')
        if (edit.state.length) {
          await flush()
          for (const change of edit.state) await rpc(...modificationCalls(change))
        }
        await rpc('anvil_impersonateAccount', [target.from])
        const fee = target.maxFeePerGas ?? env.baseFee
        const priority = target.maxPriorityFeePerGas ?? 0n
        return (await rpc('eth_sendTransaction', [{ from: target.from, to: target.to, data: edit.data ?? target.input, value: hex(edit.value ?? target.value), gas: hex(edit.gas ?? target.gas), nonce: hex(target.nonce), maxFeePerGas: hex(fee), maxPriorityFeePerGas: hex(priority) }])) as Hex
      })
      try {
        return { outcome: await inspectTransaction(rpc, mined.hash, 'Simulated'), blockNumber: mined.blockNumber }
      } finally {
        await rpc('anvil_stopImpersonatingAccount', [target.from]).catch(() => undefined)
      }
    })
  }
  return { faithful, modified, historicalBlock: faithful.blockNumber === historicalBlock }
}

export function compareToChain(chain: { status: 'success' | 'reverted'; gasUsed: bigint; logs: HistoricalLog[] }, replay: CallOutcome, replayBlock: number, historicalBlock: number): { match: boolean; rows: FidelityRow[] } {
  const chainLogs = chain.logs.map((log) => `${log.address.toLowerCase()}:${log.topics.map((topic) => topic.toLowerCase()).join(',')}:${log.data.toLowerCase()}`).join('|')
  const replayLogs = replay.logs.map((log) => `${log.address.toLowerCase()}:${log.topics.map((topic) => topic.toLowerCase()).join(',')}:${log.data.toLowerCase()}`).join('|')
  const rows: FidelityRow[] = [
    { aspect: 'Status', chain: chain.status, replay: replay.status, differs: chain.status !== replay.status },
    { aspect: 'Gas used', chain: chain.gasUsed.toLocaleString('en-US'), replay: replay.gasUsed.toLocaleString('en-US'), differs: chain.gasUsed !== replay.gasUsed },
    { aspect: 'Events', chain: String(chain.logs.length), replay: String(replay.logs.length), differs: chain.logs.length !== replay.logs.length || chainLogs !== replayLogs },
    { aspect: 'Block number', chain: historicalBlock.toLocaleString('en-US'), replay: replayBlock.toLocaleString('en-US'), differs: historicalBlock !== replayBlock },
  ]
  return { match: rows.filter((row) => row.aspect !== 'Block number').every((row) => !row.differs), rows }
}
