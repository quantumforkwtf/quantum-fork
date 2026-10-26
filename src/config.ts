import { useEffect, useSyncExternalStore } from 'react'
import { baseExplorerAddress, baseExplorerTx, type BaseNetwork } from './protocol/base'
import { resolveConfig, type Flags, type SolanaNetwork, type TokenStatus } from './protocol/config'

/**
 * Public, build-time configuration. Only VITE_-prefixed variables reach the
 * bundle. The server's /api/status is authoritative for anything that
 * involves a burn; this copy drives display and the client RPC.
 */
const resolved = resolveConfig(import.meta.env as Record<string, string | boolean | undefined>, 'VITE_')

export const CLIENT_CONFIG = resolved.config
export const CLIENT_CONFIG_ISSUES = resolved.issues
export const X_HANDLE = 'quantumforkk'
export const X_URL = `https://x.com/${X_HANDLE}`
export const GITHUB_REPO = 'quantumforkwtf/quantum-fork'
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`
export const SOLANA_CHAIN = `solana:${CLIENT_CONFIG.network === 'mainnet-beta' ? 'mainnet' : CLIENT_CONFIG.network}` as const

/** Base network for 0x hashes and addresses: the record's own network if it is a Base one, else the server's. */
function baseNetworkFor(network: string | undefined): BaseNetwork {
  if (network === 'base' || network === 'base-sepolia') return network
  return statusState.state === 'ok' ? (statusState.status.base?.network ?? 'base') : 'base'
}

/** True for networks where QFORK has value: Solana mainnet-beta and Base mainnet. */
export const isMainnetNetwork = (network: string) => network === 'mainnet-beta' || network === 'base'

export function explorerTx(signature: string, network: SolanaNetwork | BaseNetwork | string = CLIENT_CONFIG.network) {
  if (signature.startsWith('0x')) return baseExplorerTx(signature, baseNetworkFor(network))
  return `https://explorer.solana.com/tx/${signature}${network === 'mainnet-beta' ? '' : `?cluster=${network}`}`
}

export function explorerAddress(address: string, network: SolanaNetwork | BaseNetwork | string = CLIENT_CONFIG.network) {
  if (address.startsWith('0x')) return baseExplorerAddress(address, baseNetworkFor(network))
  return `https://explorer.solana.com/address/${address}${network === 'mainnet-beta' ? '' : `?cluster=${network}`}`
}

export function explorerToken(mint: string, network: SolanaNetwork) {
  return explorerAddress(mint, network)
}

export interface TierStatus {
  available: boolean
  reason: string
}

export interface ServerStatus {
  network: SolanaNetwork
  mint: string | null
  tokenStatus: TokenStatus
  pumpfunUrl: string | null
  flags: Flags
  storage: { kind: string; persistent: boolean }
  tiers: { testnet: TierStatus; mainnet: TierStatus }
  faucet: TierStatus & { amount: number }
  /** Absent on servers from before Base support. */
  base?: { network: BaseNetwork; chainId: number; token: string | null; tokenStatus: TokenStatus; tradeUrl: string | null; clankerLaunch?: boolean; registry?: string | null; registration: TierStatus }
  issues: { key: string; level: 'error' | 'warning'; message: string }[]
  audit: 'UNAUDITED'
}

type StatusState = { state: 'loading' } | { state: 'ok'; status: ServerStatus } | { state: 'offline' }

let statusState: StatusState = { state: 'loading' }
let requested = false
const listeners = new Set<() => void>()

async function loadStatus() {
  try {
    const response = await fetch('/api/status', { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(String(response.status))
    statusState = { state: 'ok', status: (await response.json()) as ServerStatus }
  } catch {
    statusState = { state: 'offline' }
  }
  listeners.forEach((listener) => listener())
}

/** Server status, fetched once per page load. Offline means every real-value action is disabled. */
export function useServerStatus(): StatusState {
  useEffect(() => {
    if (!requested) {
      requested = true
      void loadStatus()
    }
  }, [])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => statusState,
    () => statusState,
  )
}

/** A mismatch means the client and server would disagree on what to burn, so registration is blocked. */
export function configMismatch(status: ServerStatus) {
  if (status.network !== CLIENT_CONFIG.network) return `Site is built for ${CLIENT_CONFIG.network} but the server is configured for ${status.network}.`
  if (status.mint && CLIENT_CONFIG.mint && status.mint !== CLIENT_CONFIG.mint) return 'Client and server are configured with different QFORK mints.'
  return null
}
