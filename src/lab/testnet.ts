import type { Chain } from '../protocol/base'
import type { DeploymentRecord } from '../protocol/deployment'
import type { DescendantConfig } from '../protocol/descendant'
import type { BurnReceipt } from '../protocol/receipt'
import type { TokenRecord } from '../protocol/tokens'
import { api, ApiError } from '../lib/api'
import { FlowError } from '../lib/failures'

export interface RemoteDeployment {
  deployment: DeploymentRecord
  receipt: BurnReceipt | null
  tokens?: TokenRecord[]
}

export interface PendingBurn {
  deploymentId: string
  signature: string
  /** Solana only; Base burns have no blockhash expiry. */
  lastValidBlockHeight: number | null
  at: number
}

const PENDING_KEY = 'qfork.pending.v1'

export function savePending(pending: PendingBurn | null) {
  try {
    if (pending) window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    else window.localStorage.removeItem(PENDING_KEY)
  } catch {
    // Without storage, a reload mid-burn falls back to the server record.
  }
}

export function loadPending(): PendingBurn | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY)
    return raw ? (JSON.parse(raw) as PendingBurn) : null
  } catch {
    return null
  }
}

function asFlowError(error: unknown): FlowError {
  if (error instanceof FlowError) return error
  if (error instanceof ApiError) {
    if (error.code.startsWith('RPC_')) return new FlowError('RPC_UNAVAILABLE', error.message, { correlationId: error.correlationId })
    if (error.status === 0 || error.status >= 500) return new FlowError('API_UNAVAILABLE', error.message, { correlationId: error.correlationId })
    return new FlowError('API_UNAVAILABLE', `${error.code}: ${error.message}`, { correlationId: error.correlationId })
  }
  return new FlowError('API_UNAVAILABLE')
}

/** Creates (or, with the same key, returns) the server-side deployment that a burn will be bound to. */
export async function createRemoteDeployment(config: DescendantConfig, idempotencyKey: string, chain: Chain = 'solana'): Promise<RemoteDeployment> {
  try {
    const { data } = await api<RemoteDeployment>('/api/deployments', { method: 'POST', body: { config, chain }, idempotencyKey })
    return data
  } catch (error) {
    throw asFlowError(error)
  }
}

export async function fetchRemoteDeployment(id: string): Promise<RemoteDeployment> {
  try {
    const { data } = await api<RemoteDeployment>(`/api/deployments?id=${encodeURIComponent(id)}`)
    return data
  } catch (error) {
    throw asFlowError(error)
  }
}

type BurnOutcome =
  | { status: 'PENDING'; deployment: DeploymentRecord }
  | { status: 'VERIFIED'; deployment: DeploymentRecord; receipt: BurnReceipt }
  | { status: 'FAILED'; deployment: DeploymentRecord; code: string; message: string; tokensBurned: boolean }

/**
 * Asks the server to verify the burn at finalized commitment, polling while
 * it is pending. Transient API or RPC failures are retried; the signature is
 * already bound server-side, so retrying is always safe.
 */
export async function verifyRemoteBurn(deploymentId: string, signature: string, onPending: (deployment: DeploymentRecord) => void, signal?: AbortSignal, intervalMs = 3000): Promise<RemoteDeployment & { receipt: BurnReceipt }> {
  let transient = 0
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const { data } = await api<BurnOutcome>('/api/burns', { method: 'POST', body: { deploymentId, signature }, accept: [202, 422], timeoutMs: 30_000 })
      transient = 0
      if (data.status === 'VERIFIED') return { deployment: data.deployment, receipt: data.receipt }
      if (data.status === 'FAILED') {
        if (data.tokensBurned) throw new FlowError('BURN_NOT_CREDITED', `${data.code}: ${data.message}`, { signature })
        if (data.code === 'TX_EXPIRED') throw new FlowError('TX_EXPIRED', data.message, { signature })
        throw new FlowError('BURN_FAILED', data.message, { signature })
      }
      onPending(data.deployment)
    } catch (error) {
      if (error instanceof FlowError) throw error
      const flow = asFlowError(error)
      const retryable = error instanceof ApiError && (error.status === 0 || error.status === 409 || error.status >= 500)
      transient += 1
      if (!retryable || transient > 8) throw new FlowError(flow.code, flow.detail, { ...flow.extra, signature })
    }
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
  }
}
