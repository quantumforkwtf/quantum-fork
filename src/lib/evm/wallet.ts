import { useEffect, useSyncExternalStore } from 'react'
import { getAddress, type Hex, numberToHex } from 'viem'
import { BASE_EXPLORER, BASE_PUBLIC_RPC, type BaseNetwork } from '../../protocol/base'
import { FlowError } from '../failures'

/** EIP-1193 provider, as announced over EIP-6963. */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

export interface EvmWalletInfo {
  uuid: string
  name: string
  icon: string
  rdns: string
}

interface Announced {
  info: EvmWalletInfo
  provider: Eip1193
}

export interface EvmWalletState {
  wallets: EvmWalletInfo[]
  status: 'disconnected' | 'connecting' | 'connected'
  walletId: string | null
  address: Hex | null
  chainId: number | null
  error: FlowError | null
}

const STORAGE = 'qfork.evm.wallet'
const announced = new Map<string, Announced>()
let state: EvmWalletState = { wallets: [], status: 'disconnected', walletId: null, address: null, chainId: null, error: null }
const listeners = new Set<() => void>()
let started = false
let detach: (() => void) | null = null

function set(patch: Partial<EvmWalletState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function discover() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('eip6963:announceProvider', (event) => {
    const detail = (event as CustomEvent<Announced>).detail
    if (!detail?.info?.uuid || !detail.provider || announced.has(detail.info.uuid)) return
    announced.set(detail.info.uuid, detail)
    set({ wallets: [...announced.values()].map((item) => item.info) })
    const saved = window.localStorage.getItem(STORAGE)
    if (saved && saved === detail.info.rdns && state.status === 'disconnected') void connectEvm(detail.info.uuid, true)
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

function provider(): Eip1193 {
  const found = state.walletId ? announced.get(state.walletId) : null
  if (!found) throw new FlowError('EVM_WALLET_NOT_FOUND')
  return found.provider
}

function rejected(error: unknown) {
  const code = (error as { code?: number })?.code
  return code === 4001 || code === 4100
}

export async function connectEvm(uuid: string, silent = false) {
  const found = announced.get(uuid)
  if (!found) return set({ error: new FlowError('EVM_WALLET_NOT_FOUND') })
  set({ status: 'connecting', error: null, walletId: uuid })
  try {
    const accounts = (await found.provider.request({ method: silent ? 'eth_accounts' : 'eth_requestAccounts' })) as string[]
    if (!accounts?.length) return set({ status: 'disconnected', walletId: null })
    const chainId = Number(await found.provider.request({ method: 'eth_chainId' }))
    detach?.()
    const onAccounts = (...args: unknown[]) => {
      const next = args[0] as string[]
      if (!next?.length) return void disconnectEvm()
      set({ address: getAddress(next[0]) })
    }
    const onChain = (...args: unknown[]) => set({ chainId: Number(args[0]) })
    found.provider.on?.('accountsChanged', onAccounts)
    found.provider.on?.('chainChanged', onChain)
    detach = () => {
      found.provider.removeListener?.('accountsChanged', onAccounts)
      found.provider.removeListener?.('chainChanged', onChain)
    }
    window.localStorage.setItem(STORAGE, found.info.rdns)
    set({ status: 'connected', address: getAddress(accounts[0]), chainId })
  } catch (error) {
    set({ status: 'disconnected', walletId: null, error: silent ? null : new FlowError(rejected(error) ? 'WALLET_REJECTED' : 'EVM_WALLET_NOT_FOUND', (error as Error)?.message) })
  }
}

export function disconnectEvm() {
  detach?.()
  detach = null
  window.localStorage.removeItem(STORAGE)
  set({ status: 'disconnected', walletId: null, address: null, chainId: null })
}

export function clearEvmError() {
  set({ error: null })
}

/** Asks the wallet to switch to the Base network, adding it first if the wallet does not know it. */
export async function ensureBaseChain(network: BaseNetwork, chainId: number) {
  const wallet = provider()
  const hex = numberToHex(chainId)
  if (Number(await wallet.request({ method: 'eth_chainId' })) === chainId) return
  try {
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
  } catch (error) {
    if ((error as { code?: number })?.code !== 4902) {
      throw new FlowError(rejected(error) ? 'WALLET_REJECTED' : 'WRONG_NETWORK', `Switch the wallet to ${network === 'base' ? 'Base' : 'Base Sepolia'} to continue.`)
    }
    await wallet.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: hex,
          chainName: network === 'base' ? 'Base' : 'Base Sepolia',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [BASE_PUBLIC_RPC[network]],
          blockExplorerUrls: [BASE_EXPLORER[network]],
        },
      ],
    })
  }
  const now = Number(await wallet.request({ method: 'eth_chainId' }))
  if (now !== chainId) throw new FlowError('WRONG_NETWORK', `Switch the wallet to ${network === 'base' ? 'Base' : 'Base Sepolia'} to continue.`)
  set({ chainId: now })
}

/** The connected EIP-1193 provider, for reads and the one send. Throws if nothing is connected. */
export function evmProvider() {
  return provider()
}

export function useEvmWallet(): EvmWalletState {
  useEffect(discover, [])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
    () => state,
  )
}
