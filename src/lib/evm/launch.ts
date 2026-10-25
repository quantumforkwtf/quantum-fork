import { createPublicClient, custom, type Hex, numberToHex } from 'viem'
import type { BaseNetwork } from '../../protocol/base'
import type { ClankerSpec, PreparedClanker, TokenRecord } from '../../protocol/tokens'
import { api, ApiError } from '../api'
import { FlowError } from '../failures'
import { ensureBaseChain, evmProvider } from './wallet'

export interface ClankerReview {
  kind: 'clanker'
  prepared: PreparedClanker
  spec: ClankerSpec
  gas: bigint
  feeWei: bigint
  ethWei: bigint
}

const PENDING = (deploymentId: string) => `qfork.clanker.pending.${deploymentId}`

function reader() {
  return createPublicClient({ transport: custom(evmProvider()) })
}

function asFlow(error: unknown): FlowError {
  if (error instanceof FlowError) return error
  if (error instanceof ApiError) return new FlowError(error.code.startsWith('RPC_') ? 'RPC_UNAVAILABLE' : 'API_UNAVAILABLE', error.message, { correlationId: error.correlationId })
  return new FlowError('API_UNAVAILABLE')
}

/** Asks the server for the exact deployToken call, then dry-runs it from the owner's wallet. Nothing is signed. */
export async function prepareClankerLaunch(deploymentId: string, wallet: Hex, spec: ClankerSpec, network: BaseNetwork, chainId: number): Promise<ClankerReview> {
  let prepared: PreparedClanker
  try {
    ;({ prepared } = (await api<{ prepared: PreparedClanker }>('/api/tokens', { method: 'POST', body: { action: 'prepare-clanker', deploymentId, wallet, spec }, timeoutMs: 25_000 })).data)
  } catch (error) {
    throw asFlow(error)
  }
  await ensureBaseChain(network, chainId)
  const client = reader()
  try {
    const [ethWei, gasPrice] = await Promise.all([client.getBalance({ address: wallet }), client.getGasPrice()])
    let gas: bigint
    try {
      gas = await client.estimateGas({ account: wallet, to: prepared.to as Hex, data: prepared.data as Hex, value: 0n })
    } catch (error) {
      throw new FlowError('SIMULATION_FAILED', `The dry run failed. Nothing was sent. ${(error as Error)?.message?.split('\n')[0] ?? ''}`.trim())
    }
    const feeWei = gas * gasPrice
    if (ethWei < feeWei) throw new FlowError('INSUFFICIENT_ETH', `Gas is about ${Number(feeWei) / 1e18} ETH; the wallet holds ${Number(ethWei) / 1e18} ETH.`)
    return { kind: 'clanker', prepared, spec, gas, feeWei, ethWei }
  } catch (error) {
    if (error instanceof FlowError) throw error
    throw new FlowError('RPC_UNAVAILABLE', (error as Error)?.message?.split('\n')[0])
  }
}

/** Sends exactly the reviewed call from the owner's wallet and reads it back before trusting the hash. */
export async function sendClankerLaunch(review: ClankerReview): Promise<Hex> {
  const { prepared } = review
  await ensureBaseChain(prepared.cluster as BaseNetwork, prepared.chainId)
  let hash: Hex
  try {
    hash = (await evmProvider().request({
      method: 'eth_sendTransaction',
      params: [{ from: prepared.wallet, to: prepared.to, data: prepared.data, value: '0x0', gas: numberToHex((review.gas * 12n) / 10n) }],
    })) as Hex
  } catch (error) {
    const code = (error as { code?: number })?.code
    throw new FlowError(code === 4001 ? 'WALLET_REJECTED' : 'SIMULATION_FAILED', (error as Error)?.message?.split('\n')[0])
  }
  rememberClanker(prepared.deploymentId, { launchId: prepared.launchId, hash, cluster: prepared.cluster })
  const sent = await reader()
    .getTransaction({ hash })
    .catch(() => null)
  if (sent && (sent.input.toLowerCase() !== prepared.data.toLowerCase() || sent.to?.toLowerCase() !== prepared.to.toLowerCase())) {
    throw new FlowError('TX_MODIFIED', undefined, { signature: hash })
  }
  return hash
}

type Outcome = { status: 'PENDING' } | { status: 'VERIFIED'; token: TokenRecord } | { status: 'FAILED'; code: string; message: string }

/** Polls the server until it has read the deployToken transaction at a finalized Base block. */
export async function verifyClankerLaunch(deploymentId: string, launchId: string, hash: Hex, signal?: AbortSignal): Promise<TokenRecord> {
  let transient = 0
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const { data } = await api<Outcome>('/api/tokens', { method: 'POST', body: { action: 'verify-clanker', launchId, hash }, accept: [202, 422], timeoutMs: 25_000 })
      transient = 0
      if (data.status === 'VERIFIED') {
        forgetClanker(deploymentId)
        return data.token
      }
      if (data.status === 'FAILED') {
        forgetClanker(deploymentId)
        throw new FlowError(data.code === 'TX_FAILED' ? 'TOKEN_FAILED' : 'TOKEN_NOT_RECORDED', data.message, { signature: hash })
      }
    } catch (error) {
      if (error instanceof FlowError) throw error
      if (error instanceof ApiError && error.status === 404) {
        forgetClanker(deploymentId)
        throw new FlowError('TOKEN_NOT_RECORDED', error.message, { signature: hash })
      }
      transient += 1
      if (transient > 6) throw new FlowError('TOKEN_NOT_RECORDED', 'The server could not be reached to verify the token. Reopen this dialog to resume.', { signature: hash })
    }
    await new Promise((resolve) => window.setTimeout(resolve, 10_000))
  }
  throw new FlowError('TOKEN_NOT_RECORDED', 'Base has not finalized the transaction yet. Reopen this dialog to resume.', { signature: hash })
}

export interface PendingClanker {
  launchId: string
  hash: Hex
  cluster: string
}

function rememberClanker(deploymentId: string, pending: PendingClanker) {
  try {
    localStorage.setItem(PENDING(deploymentId), JSON.stringify(pending))
  } catch {
    // Storage may be unavailable; verification still runs in this tab.
  }
}

function forgetClanker(deploymentId: string) {
  try {
    localStorage.removeItem(PENDING(deploymentId))
  } catch {
    // Nothing to clear.
  }
}

/** A launch sent from this browser that the server has not recorded yet. */
export function pendingClanker(deploymentId: string): PendingClanker | null {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING(deploymentId)) ?? 'null') as PendingClanker | null
    return value && /^clk_[0-9a-f]{32}$/.test(value.launchId) && /^0x[0-9a-fA-F]{64}$/.test(value.hash) ? value : null
  } catch {
    return null
  }
}
