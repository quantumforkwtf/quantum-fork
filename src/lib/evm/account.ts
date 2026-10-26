import { createPublicClient, custom, type Hex, http, isAddress, numberToHex } from 'viem'
import { ACCOUNT_FACTORY_DEPLOYMENTS, ACCOUNT_NETWORK as RECORDED_NETWORK, accountErrorMessage } from '../../protocol/account'
import { BASE_CHAIN_ID, BASE_PUBLIC_RPC, type BaseNetwork } from '../../protocol/base'
import { FlowError, isUserRejection } from '../failures'
import { ensureBaseChain, evmProvider } from './wallet'

const env = import.meta.env as Record<string, string | undefined>
const networkOverride = env.VITE_QFORK_ACCOUNT_NETWORK
const factoryOverride = env.VITE_QFORK_ACCOUNT_FACTORY

/** Build-time overrides exist for local devnets; production uses the recorded deployment. */
export const ACCOUNT_NETWORK: BaseNetwork = networkOverride === 'base' || networkOverride === 'base-sepolia' ? networkOverride : RECORDED_NETWORK
export const ACCOUNT_CHAIN_ID = BASE_CHAIN_ID[ACCOUNT_NETWORK]
export const ACCOUNT_MAINNET = ACCOUNT_NETWORK === 'base'
export const ACCOUNT_NETWORK_LABEL = ACCOUNT_MAINNET ? 'Base' : 'Base Sepolia'
/** The factory on ACCOUNT_NETWORK, or null while it is not deployed there. */
export const ACCOUNT_FACTORY: Hex | null = factoryOverride && isAddress(factoryOverride) ? factoryOverride : ACCOUNT_FACTORY_DEPLOYMENTS[ACCOUNT_NETWORK]

/** Reads go through the wallet when it is on the account network, else Base's public endpoint. */
export function accountReader(chainId: number | null) {
  if (chainId === ACCOUNT_CHAIN_ID) {
    try {
      return createPublicClient({ transport: custom(evmProvider()) })
    } catch {
      // No wallet connected.
    }
  }
  return createPublicClient({ transport: http(env.VITE_QFORK_ACCOUNT_RPC || BASE_PUBLIC_RPC[ACCOUNT_NETWORK]) })
}

function revertData(error: unknown): Hex | undefined {
  for (let cause = error as { data?: unknown; cause?: unknown } | undefined, depth = 0; cause && depth < 8; cause = cause.cause as typeof cause, depth += 1) {
    if (typeof cause.data === 'string' && cause.data.startsWith('0x')) return cause.data as Hex
    if (cause.data && typeof cause.data === 'object' && typeof (cause.data as { data?: unknown }).data === 'string') return (cause.data as { data: Hex }).data
  }
  return undefined
}

const firstLine = (error: unknown) => ((error as { shortMessage?: string })?.shortMessage ?? (error as Error)?.message ?? 'Unknown error').split('\n')[0]

export interface AccountTx {
  from: Hex
  to: Hex
  data: Hex
  value?: bigint
}

/**
 * Dry-runs the call first so a revert is explained before the wallet opens, then sends it and
 * waits for the receipt. The wallet shows the exact call; nothing is signed here.
 */
export async function sendAccountTx(tx: AccountTx, onSent?: (hash: Hex) => void, units?: (raw: bigint) => string): Promise<Hex> {
  await ensureBaseChain(ACCOUNT_NETWORK, ACCOUNT_CHAIN_ID)
  const client = createPublicClient({ transport: custom(evmProvider()) })
  const value = tx.value ?? 0n
  let gas: bigint
  try {
    gas = await client.estimateGas({ account: tx.from, to: tx.to, data: tx.data, value })
  } catch (error) {
    const explained = accountErrorMessage(revertData(error), units)
    if (/insufficient funds/i.test(firstLine(error))) throw new FlowError('INSUFFICIENT_ETH', `The wallet does not hold enough ${ACCOUNT_NETWORK_LABEL} ETH for gas.`)
    throw new FlowError('ACCOUNT_REJECTED', explained ?? firstLine(error))
  }
  let hash: Hex
  try {
    hash = (await evmProvider().request({ method: 'eth_sendTransaction', params: [{ from: tx.from, to: tx.to, data: tx.data, value: numberToHex(value), gas: numberToHex((gas * 13n) / 10n) }] })) as Hex
  } catch (error) {
    throw new FlowError(isUserRejection(error) ? 'WALLET_REJECTED' : 'ACCOUNT_TX_FAILED', firstLine(error))
  }
  onSent?.(hash)
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 1500, timeout: 120_000 })
  if (receipt.status !== 'success') throw new FlowError('ACCOUNT_TX_FAILED', 'The transaction reverted on-chain.', { signature: hash })
  return hash
}
