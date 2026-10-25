import { type Hex, isAddress, isHex } from 'viem'
import { z } from 'zod'
import { BASE_CHAIN_ID, BASE_PUBLIC_RPC, type BaseNetwork } from './base.js'

/**
 * Reality Fork: the same calls run on two local Anvil forks of one Base block, one of them
 * modified, and the outcomes compared. Everything runs on the user's machine; nothing here
 * sends a transaction to Base.
 */

export const FORK_SPEC = 'qfork/reality-fork/v1'
export const MAX_MODIFICATIONS = 16
export const MAX_CALLS = 8
export const DEFAULT_PORTS = { original: 8545, modified: 8546 } as const
export const SENDER_FUNDING_WEI = 10n ** 19n

const address = z.string().refine((value) => isAddress(value, { strict: false }), 'Not a 0x address').transform((value) => value.toLowerCase() as Hex)
const word = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'A hex value up to 32 bytes').transform((value) => `0x${value.slice(2).toLowerCase().padStart(64, '0')}` as Hex)
const bytes = z.string().refine((value) => isHex(value, { strict: true }) && value.length % 2 === 0, 'Hex bytes, e.g. 0x6001…').transform((value) => value.toLowerCase() as Hex)
const wei = z.string().regex(/^\d{1,40}$/, 'A whole number of wei')

export const modificationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('code'), address, code: bytes.refine((value) => value.length <= 2 + 2 * 24_576, 'Code is larger than the 24,576-byte limit') }).strict(),
  z.object({ kind: z.literal('storage'), address, slot: word, value: word }).strict(),
  z.object({ kind: z.literal('balance'), address, wei }).strict(),
])
export type Modification = z.infer<typeof modificationSchema>

export const forkCallSchema = z
  .object({
    label: z.string().trim().max(48).default(''),
    from: address,
    to: address,
    data: bytes.default('0x'),
    valueWei: wei.default('0'),
    gas: z.number().int().min(21_000).max(30_000_000).default(3_000_000),
  })
  .strict()
export type ForkCall = z.infer<typeof forkCallSchema>

export const scenarioSchema = z
  .object({
    spec: z.literal(FORK_SPEC),
    source: z.enum(['base', 'base-sepolia']),
    block: z.number().int().min(1),
    fundSenders: z.boolean().default(true),
    modifications: z.array(modificationSchema).max(MAX_MODIFICATIONS),
    calls: z.array(forkCallSchema).min(1).max(MAX_CALLS),
  })
  .strict()
export type Scenario = z.infer<typeof scenarioSchema>
export type ScenarioInput = z.input<typeof scenarioSchema>

export function parseScenario(value: unknown): { ok: true; scenario: Scenario } | { ok: false; issues: string[] } {
  const parsed = scenarioSchema.safeParse(value)
  if (parsed.success) return { ok: true, scenario: parsed.data }
  return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'scenario'}: ${issue.message}`) }
}

/** The two Anvil commands for a scenario. Both fork the same block; only the second receives modifications. */
export function forkCommands(source: BaseNetwork, block: number, rpcUrl = BASE_PUBLIC_RPC[source]) {
  const base = (port: number) => `anvil --fork-url ${rpcUrl} --fork-block-number ${block} --port ${port}`
  return { original: base(DEFAULT_PORTS.original), modified: base(DEFAULT_PORTS.modified) }
}

/** Anvil-only RPC methods are sent to loopback addresses and nowhere else. */
export function isLoopbackRpc(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.pathname === '/' && !parsed.search && !parsed.username
  } catch {
    return false
  }
}

// ---------- identity ----------

export interface AnvilMetadata {
  clientVersion: string
  chainId: number
  instanceId: Hex
  forkedNetwork?: { chainId: number; forkBlockNumber: number; forkBlockHash: Hex } | null
}

export type IdentityIssue =
  | { code: 'NOT_ANVIL'; message: string }
  | { code: 'NOT_A_FORK'; message: string }
  | { code: 'WRONG_CHAIN'; message: string }
  | { code: 'WRONG_BLOCK'; message: string }
  | { code: 'HASH_MISMATCH'; message: string }

/**
 * Checks that a node is Anvil, forked from the expected Base network at the expected block, and
 * that its fork block hash equals the hash the real network reports for that block.
 */
export function checkForkIdentity(metadata: AnvilMetadata, expected: { source: BaseNetwork; block: number; blockHash: Hex | null }): IdentityIssue[] {
  if (!metadata.clientVersion?.startsWith('anvil/')) return [{ code: 'NOT_ANVIL', message: `This node reports "${metadata.clientVersion ?? 'unknown'}", not Anvil.` }]
  const fork = metadata.forkedNetwork
  if (!fork) return [{ code: 'NOT_A_FORK', message: 'This Anvil node is not forked from any network.' }]
  const issues: IdentityIssue[] = []
  const chainId = BASE_CHAIN_ID[expected.source]
  if (fork.chainId !== chainId) issues.push({ code: 'WRONG_CHAIN', message: `Forked from chain ${fork.chainId}, expected ${chainId}.` })
  if (fork.forkBlockNumber !== expected.block) issues.push({ code: 'WRONG_BLOCK', message: `Forked at block ${fork.forkBlockNumber}, expected ${expected.block}.` })
  else if (expected.blockHash && fork.forkBlockHash.toLowerCase() !== expected.blockHash.toLowerCase()) issues.push({ code: 'HASH_MISMATCH', message: 'The fork block hash does not match the real network at that block.' })
  return issues
}

// ---------- engine ----------

export type Rpc = (method: string, params?: unknown[]) => Promise<unknown>

export interface CallFrame {
  type: string
  from: Hex
  to?: Hex
  value?: Hex
  gasUsed?: Hex
  input?: Hex
  output?: Hex
  error?: string
  revertReason?: string
  calls?: CallFrame[]
}

export interface StateChange {
  address: Hex
  field: 'balance' | 'nonce' | 'code' | `storage:${string}`
  before: string | null
  after: string | null
}

export interface CallOutcome {
  label: string
  txHash: Hex
  status: 'success' | 'reverted'
  gasUsed: bigint
  output: Hex
  error: string | null
  logs: { address: Hex; topics: Hex[]; data: Hex }[]
  frames: FlatFrame[]
  changes: StateChange[]
}

export interface FlatFrame {
  depth: number
  type: string
  from: Hex
  to: Hex | null
  value: bigint
  gasUsed: bigint
  error: string | null
}

export interface RunResult {
  forkBlock: number
  modifications: number
  outcomes: CallOutcome[]
}

interface Receipt {
  status: Hex
  gasUsed: Hex
  logs: { address: Hex; topics: Hex[]; data: Hex }[]
}

type PrestateAccount = { balance?: Hex; nonce?: number; code?: Hex; storage?: Record<Hex, Hex> }

const toHex = (value: bigint) => `0x${value.toString(16)}` as Hex

export function modificationCalls(modification: Modification): [string, unknown[]] {
  if (modification.kind === 'code') return ['anvil_setCode', [modification.address, modification.code]]
  if (modification.kind === 'storage') return ['anvil_setStorageAt', [modification.address, modification.slot, modification.value]]
  return ['anvil_setBalance', [modification.address, toHex(BigInt(modification.wei))]]
}

export function flattenFrames(frame: CallFrame, depth = 0, into: FlatFrame[] = []): FlatFrame[] {
  into.push({
    depth,
    type: frame.type,
    from: frame.from,
    to: frame.to ?? null,
    value: frame.value ? BigInt(frame.value) : 0n,
    gasUsed: frame.gasUsed ? BigInt(frame.gasUsed) : 0n,
    error: frame.revertReason ?? frame.error ?? null,
  })
  for (const child of frame.calls ?? []) flattenFrames(child, depth + 1, into)
  return into
}

/** Normalises a prestateTracer diff into one row per changed field. */
export function stateChanges(diff: { pre: Record<string, PrestateAccount>; post: Record<string, PrestateAccount> }): StateChange[] {
  const rows: StateChange[] = []
  const addresses = [...new Set([...Object.keys(diff.pre), ...Object.keys(diff.post)])].sort()
  for (const raw of addresses) {
    if (!diff.post[raw]) continue
    const address = raw.toLowerCase() as Hex
    const pre = diff.pre[raw] ?? {}
    const post = diff.post[raw]
    if (post.balance !== undefined && post.balance !== pre.balance) rows.push({ address, field: 'balance', before: pre.balance ? BigInt(pre.balance).toString() : '0', after: BigInt(post.balance).toString() })
    if (post.nonce !== undefined && post.nonce !== pre.nonce) rows.push({ address, field: 'nonce', before: String(pre.nonce ?? 0), after: String(post.nonce) })
    if (post.code !== undefined && post.code !== pre.code) rows.push({ address, field: 'code', before: pre.code ?? null, after: post.code })
    const slots = new Set([...Object.keys(pre.storage ?? {}), ...Object.keys(post.storage ?? {})])
    for (const slot of [...slots].sort()) {
      // In diff mode a slot listed before but missing after was cleared to zero.
      const before = pre.storage?.[slot as Hex] ?? null
      const after = post.storage?.[slot as Hex] ?? null
      if (after !== before) rows.push({ address, field: `storage:${slot.toLowerCase()}`, before, after })
    }
  }
  return rows
}

/** Receipt, call tree, and state diff for a transaction a fork has already mined. */
export async function inspectTransaction(rpc: Rpc, txHash: Hex, label: string): Promise<CallOutcome> {
  const receipt = await receiptOf(rpc, txHash)
  const trace = (await rpc('debug_traceTransaction', [txHash, { tracer: 'callTracer' }])) as CallFrame
  const diff = (await rpc('debug_traceTransaction', [txHash, { tracer: 'prestateTracer', tracerConfig: { diffMode: true } }])) as { pre: Record<string, PrestateAccount>; post: Record<string, PrestateAccount> }
  return {
    label,
    txHash,
    status: receipt.status === '0x1' ? 'success' : 'reverted',
    gasUsed: BigInt(receipt.gasUsed),
    output: trace.output ?? '0x',
    error: trace.revertReason ?? trace.error ?? null,
    logs: receipt.logs.map((log) => ({ address: log.address.toLowerCase() as Hex, topics: log.topics, data: log.data })),
    frames: flattenFrames(trace),
    changes: stateChanges(diff),
  }
}

async function receiptOf(rpc: Rpc, txHash: Hex): Promise<Receipt> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const receipt = (await rpc('eth_getTransactionReceipt', [txHash])) as Receipt | null
    if (receipt) return receipt
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`No receipt for ${txHash}. Is Anvil mining (automine is the default)?`)
}

/**
 * Runs a scenario on one fork and returns it to the exact state it started in.
 * With `modify`, the scenario's modifications are applied first.
 */
export async function runOnFork(rpc: Rpc, scenario: Scenario, modify: boolean): Promise<RunResult> {
  const metadata = (await rpc('anvil_metadata')) as AnvilMetadata
  const forkBlock = metadata.forkedNetwork?.forkBlockNumber
  if (forkBlock === undefined) throw new Error('This node is not a fork.')
  const head = (await rpc('eth_getBlockByNumber', [toHex(BigInt(forkBlock)), false])) as { timestamp: Hex; baseFeePerGas?: Hex }
  const snapshot = (await rpc('evm_snapshot')) as Hex
  const senders = [...new Set(scenario.calls.map((call) => call.from))]
  try {
    if (scenario.fundSenders) for (const sender of senders) await rpc('anvil_setBalance', [sender, toHex(SENDER_FUNDING_WEI)])
    if (modify) for (const modification of scenario.modifications) await rpc(...modificationCalls(modification))
    for (const sender of senders) await rpc('anvil_impersonateAccount', [sender])

    // Every run mines the same blocks: Base's 2 s cadence after the fork block, at the fork block's base fee, no tip.
    const baseFee = head.baseFeePerGas ?? '0x0'
    const outcomes: CallOutcome[] = []
    for (const [index, call] of scenario.calls.entries()) {
      await rpc('evm_setNextBlockTimestamp', [toHex(BigInt(head.timestamp) + BigInt(2 * (index + 1)))])
      await rpc('anvil_setNextBlockBaseFeePerGas', [baseFee])
      const txHash = (await rpc('eth_sendTransaction', [{ from: call.from, to: call.to, data: call.data, value: toHex(BigInt(call.valueWei)), gas: toHex(BigInt(call.gas)), maxFeePerGas: baseFee, maxPriorityFeePerGas: '0x0' }])) as Hex
      outcomes.push(await inspectTransaction(rpc, txHash, call.label || `Call ${index + 1}`))
    }
    return { forkBlock, modifications: modify ? scenario.modifications.length : 0, outcomes }
  } finally {
    for (const sender of senders) await rpc('anvil_stopImpersonatingAccount', [sender]).catch(() => undefined)
    await rpc('evm_revert', [snapshot])
  }
}

// ---------- comparison ----------

export interface CompareRow {
  call: string
  aspect: string
  original: string
  modified: string
  differs: boolean
}

/** Fields that legitimately differ between any two runs (block coinbase rewards) are excluded. */
function comparableChanges(outcome: CallOutcome) {
  return new Map(outcome.changes.filter((change) => !(change.field === 'balance' && change.address === '0x0000000000000000000000000000000000000000')).map((change) => [`${change.address} ${change.field}`, change.after ?? '∅']))
}

export function compareRuns(original: RunResult, modified: RunResult): CompareRow[] {
  const rows: CompareRow[] = []
  const count = Math.max(original.outcomes.length, modified.outcomes.length)
  for (let index = 0; index < count; index++) {
    const a = original.outcomes[index]
    const b = modified.outcomes[index]
    const call = a?.label ?? b?.label ?? `Call ${index + 1}`
    const push = (aspect: string, left: string, right: string) => rows.push({ call, aspect, original: left, modified: right, differs: left !== right })
    push('Status', a?.status ?? '—', b?.status ?? '—')
    push('Gas used', a ? a.gasUsed.toLocaleString('en-US') : '—', b ? b.gasUsed.toLocaleString('en-US') : '—')
    push('Return data', a?.output ?? '—', b?.output ?? '—')
    push('Error', a?.error ?? 'none', b?.error ?? 'none')
    push('Events', String(a?.logs.length ?? 0), String(b?.logs.length ?? 0))
    push('Internal calls', String(Math.max(0, (a?.frames.length ?? 1) - 1)), String(Math.max(0, (b?.frames.length ?? 1) - 1)))
    const left = a ? comparableChanges(a) : new Map<string, string>()
    const right = b ? comparableChanges(b) : new Map<string, string>()
    for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) push(key, left.get(key) ?? 'unchanged', right.get(key) ?? 'unchanged')
  }
  return rows
}

export function blankScenario(source: BaseNetwork, block: number): ScenarioInput {
  return {
    spec: FORK_SPEC,
    source,
    block,
    fundSenders: true,
    modifications: [],
    calls: [{ label: '', from: '0x000000000000000000000000000000000000dEaD', to: '0x4200000000000000000000000000000000000006', data: '0x', valueWei: '0', gas: 3_000_000 }],
  }
}
