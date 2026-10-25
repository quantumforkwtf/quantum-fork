import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { BENCH_BYTECODE } from './benchBytecode.js'

/**
 * Fork Wars runs fixed contracts on local Anvil nodes and records what those nodes actually did.
 * The signing key is Anvil's public development account. It is never used against Base.
 */

export const FORK_WARS_SPEC = 'qfork/fork-wars/v1'
export const BENCH_COUNT_MIN = 4
export const BENCH_COUNT_MAX = 12
/** Anvil's published development key. It only has ETH on a fresh Anvil, and only there. */
const DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const RECIPIENT = '0x0000000000000000000000000000000000000002' as const
const STORAGE_SLOTS = 32n
const HASH_ROUNDS = 64n

export const WORKLOADS = ['erc20', 'erc721', 'deploy', 'storage', 'compute', 'mixed'] as const
export type WorkloadId = (typeof WORKLOADS)[number]

export const PROFILES = {
  automine: {
    label: 'Automine',
    detail: 'Mines each transaction as soon as it arrives. Gas limit 30,000,000. Base fee 0.',
    args: ['--host', '127.0.0.1', '--chain-id', '31337', '--gas-limit', '30000000', '--base-fee', '0'],
  },
  interval: {
    label: 'One-second blocks',
    detail: 'Mines on a one-second interval. Same gas limit and base fee as Automine.',
    args: ['--host', '127.0.0.1', '--chain-id', '31337', '--gas-limit', '30000000', '--base-fee', '0', '--block-time', '1'],
  },
} as const
export type ProfileId = keyof typeof PROFILES

export interface TxSample {
  label: string
  hash: Hex | null
  status: 'success' | 'reverted' | 'rejected'
  gasUsed: bigint
  latencyMs: number
  error: string | null
}

export interface SideSummary {
  transactions: number
  succeeded: number
  failed: number
  failureRate: number
  totalGas: bigint
  meanGas: bigint | null
  meanLatencyMs: number | null
  elapsedMs: number
  throughputPerSec: number | null
}

export interface ResourceSample {
  peakRssKb: number
  meanCpuPercent: number | null
  observations: number
}

export interface SideReport {
  profile: ProfileId
  args: readonly string[]
  samples: TxSample[]
  summary: SideSummary
  resources?: ResourceSample
}

export interface BenchReport {
  spec: typeof FORK_WARS_SPEC
  workload: WorkloadId
  count: number
  startedAt: string
  sides: SideReport[]
  methodology: string
  machine?: { platform: string; arch: string; cpuModel: string | null; cpus: number; node: string; anvil: string | null }
}

const erc20 = [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const
const erc721 = [{ type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'id', type: 'uint256' }], outputs: [] }] as const
const storage = [{ type: 'function', name: 'write', stateMutability: 'nonpayable', inputs: [{ name: 'count', type: 'uint256' }], outputs: [] }] as const
const compute = [{ type: 'function', name: 'hashLoop', stateMutability: 'pure', inputs: [{ name: 'rounds', type: 'uint256' }], outputs: [{ type: 'bytes32' }] }] as const

export function isWorkload(value: string): value is WorkloadId {
  return (WORKLOADS as readonly string[]).includes(value)
}

export function isProfile(value: string): value is ProfileId {
  return value in PROFILES
}

export function summarize(samples: TxSample[], elapsedMs: number): SideSummary {
  const succeeded = samples.filter((sample) => sample.status === 'success')
  const failed = samples.length - succeeded.length
  const totalGas = samples.reduce((sum, sample) => sum + sample.gasUsed, 0n)
  const meanLatency = samples.length ? samples.reduce((sum, sample) => sum + sample.latencyMs, 0) / samples.length : null
  return {
    transactions: samples.length,
    succeeded: succeeded.length,
    failed,
    failureRate: samples.length ? failed / samples.length : 0,
    totalGas,
    meanGas: succeeded.length ? totalGas / BigInt(succeeded.length) : null,
    meanLatencyMs: meanLatency,
    elapsedMs,
    throughputPerSec: elapsedMs > 0 ? succeeded.length / (elapsedMs / 1000) : null,
  }
}

function assertLoopback(url: string) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) throw new Error('A benchmark only talks to http://127.0.0.1:<port> or http://localhost:<port>.')
}

interface Step {
  label: string
  data: Hex
  gas: bigint
}

function stepsFor(workload: WorkloadId, count: number): Step[] {
  const deploy = (label: string, data: Hex): Step => ({ label, data, gas: 1_000_000n })
  const call = (label: string, data: Hex, gas: bigint): Step => ({ label, data, gas })
  const repeat = (label: string, data: Hex, gas: bigint) => Array.from({ length: count }, (_, index) => call(`${label} ${index + 1}`, data, gas))
  if (workload === 'deploy') return Array.from({ length: count }, (_, index) => deploy(`Deploy ${index + 1}`, BENCH_BYTECODE.BenchERC20))
  if (workload === 'erc20') return [deploy('Deploy ERC-20', BENCH_BYTECODE.BenchERC20), ...repeat('ERC-20 transfer', '0x', 120_000n)]
  if (workload === 'erc721') return [deploy('Deploy ERC-721', BENCH_BYTECODE.BenchERC721), ...repeat('ERC-721 transfer', '0x', 120_000n)]
  if (workload === 'storage') return [deploy('Deploy storage', BENCH_BYTECODE.BenchStorage), ...repeat('Storage write', encodeFunctionData({ abi: storage, functionName: 'write', args: [STORAGE_SLOTS] }), 3_000_000n)]
  if (workload === 'compute') return [deploy('Deploy compute', BENCH_BYTECODE.BenchCompute), ...repeat('Hash loop', encodeFunctionData({ abi: compute, functionName: 'hashLoop', args: [HASH_ROUNDS] }), 2_000_000n)]
  return [
    deploy('Deploy ERC-20', BENCH_BYTECODE.BenchERC20),
    call('ERC-20 transfer', '0x', 120_000n),
    deploy('Deploy ERC-721', BENCH_BYTECODE.BenchERC721),
    call('ERC-721 transfer', '0x', 120_000n),
    deploy('Deploy storage', BENCH_BYTECODE.BenchStorage),
    call('Storage write', encodeFunctionData({ abi: storage, functionName: 'write', args: [STORAGE_SLOTS] }), 3_000_000n),
    deploy('Deploy compute', BENCH_BYTECODE.BenchCompute),
    call('Hash loop', encodeFunctionData({ abi: compute, functionName: 'hashLoop', args: [HASH_ROUNDS] }), 2_000_000n),
  ]
}

/** Runs one workload against one local Anvil. Every sample comes from a receipt or a rejected send. */
export async function runWorkload(url: string, workload: WorkloadId, count: number): Promise<{ samples: TxSample[]; elapsedMs: number }> {
  assertLoopback(url)
  if (!Number.isInteger(count) || count < BENCH_COUNT_MIN || count > BENCH_COUNT_MAX) throw new Error(`Workload size has to be a whole number from ${BENCH_COUNT_MIN} to ${BENCH_COUNT_MAX}.`)
  const account = privateKeyToAccount(DEV_KEY)
  const chain = defineChain({ id: 31337, name: 'Fork Wars', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [url] } } })
  const transport = http(url, { timeout: 20_000 })
  const wallet = createWalletClient({ account, chain, transport })
  const reader = createPublicClient({ chain, transport, pollingInterval: 50 })
  const planned = stepsFor(workload, count)
  let erc20At: Hex | null = null
  let erc721At: Hex | null = null
  let last: Hex | null = null
  let holder = account.address
  const samples: TxSample[] = []
  const started = Date.now()
  for (const step of planned) {
    let data = step.data
    let to: Hex | undefined
    if (step.label.startsWith('ERC-20 transfer') && erc20At) {
      to = erc20At
      data = encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [RECIPIENT, 1n] })
    } else if (step.label.startsWith('ERC-721 transfer') && erc721At) {
      to = erc721At
      const next = holder.toLowerCase() === account.address.toLowerCase() ? RECIPIENT : account.address
      data = encodeFunctionData({ abi: erc721, functionName: 'transferFrom', args: [holder, next, 1n] })
      holder = next
    } else if (!step.label.startsWith('Deploy')) to = last ?? undefined
    const mark = Date.now()
    try {
      const hash = await wallet.sendTransaction(to ? { to, data, gas: step.gas } : { data, gas: step.gas })
      const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 30_000, pollingInterval: 50 })
      if (receipt.contractAddress) last = receipt.contractAddress
      if (step.label.includes('ERC-20') && receipt.contractAddress) erc20At = receipt.contractAddress
      if (step.label.includes('ERC-721') && receipt.contractAddress) erc721At = receipt.contractAddress
      samples.push({ label: step.label, hash, status: receipt.status === 'success' ? 'success' : 'reverted', gasUsed: receipt.gasUsed, latencyMs: Date.now() - mark, error: receipt.status === 'success' ? null : 'reverted' })
    } catch (cause) {
      samples.push({ label: step.label, hash: null, status: 'rejected', gasUsed: 0n, latencyMs: Date.now() - mark, error: cause instanceof Error ? cause.message : 'rejected' })
    }
  }
  return { samples, elapsedMs: Date.now() - started }
}
