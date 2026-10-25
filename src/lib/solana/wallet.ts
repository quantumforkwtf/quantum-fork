import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import type { StandardConnectFeature, StandardDisconnectFeature, StandardEventsFeature } from '@wallet-standard/features'
import type { SolanaSignTransactionFeature } from '@solana/wallet-standard-features'
import { useEffect, useSyncExternalStore } from 'react'
import { CLIENT_CONFIG, SOLANA_CHAIN } from '../../config'
import { FlowError, isUserRejection } from '../failures'
import { rpc } from './rpc'

export interface WalletOption {
  name: string
  icon: string
  supportsChain: boolean
}

export interface Balances {
  lamports: bigint | null
  qforkRaw: bigint | null
  qforkDecimals: number | null
  loadedAt: number
  error: string | null
}

export interface WalletState {
  ready: boolean
  options: WalletOption[]
  status: 'disconnected' | 'connecting' | 'connected'
  walletName: string | null
  address: string | null
  balances: Balances | null
  error: FlowError | null
}

const REMEMBER_KEY = 'qfork.wallet.v1'

let state: WalletState = { ready: false, options: [], status: 'disconnected', walletName: null, address: null, balances: null, error: null }
let wallet: Wallet | null = null
let account: WalletAccount | null = null
let unsubscribeEvents: (() => void) | null = null
const listeners = new Set<() => void>()
let initialized = false

function set(patch: Partial<WalletState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function usable(candidate: Wallet) {
  return 'standard:connect' in candidate.features && 'solana:signTransaction' in candidate.features && candidate.chains.some((chain) => chain.startsWith('solana:'))
}

function refreshOptions() {
  const all = getWallets().get().filter(usable)
  set({ ready: true, options: all.map((item) => ({ name: item.name, icon: item.icon, supportsChain: item.chains.includes(SOLANA_CHAIN) })) })
  return all
}

function findWallet(name: string) {
  return getWallets().get().filter(usable).find((item) => item.name === name) ?? null
}

function pickAccount(accounts: readonly WalletAccount[]) {
  return accounts.find((item) => item.chains.includes(SOLANA_CHAIN)) ?? accounts.find((item) => item.chains.length === 0) ?? null
}

function attach(next: Wallet, nextAccount: WalletAccount) {
  wallet = next
  account = nextAccount
  unsubscribeEvents?.()
  const events = (next.features as Partial<StandardEventsFeature>)['standard:events']
  unsubscribeEvents = events
    ? events.on('change', ({ accounts }) => {
        if (!accounts) return
        const changed = pickAccount(accounts)
        if (!changed) return detach()
        account = changed
        set({ address: changed.address, balances: null })
        void refreshBalances()
      })
    : null
  try {
    window.localStorage.setItem(REMEMBER_KEY, next.name)
  } catch {
    // Remembering the wallet is optional.
  }
  set({ status: 'connected', walletName: next.name, address: nextAccount.address, error: null, balances: null })
  void refreshBalances()
}

function detach() {
  unsubscribeEvents?.()
  unsubscribeEvents = null
  wallet = null
  account = null
  set({ status: 'disconnected', walletName: null, address: null, balances: null })
}

export async function connect(name: string, silent = false) {
  const target = findWallet(name)
  if (!target) {
    if (!silent) set({ error: new FlowError('WALLET_NOT_FOUND') })
    return
  }
  if (!target.chains.includes(SOLANA_CHAIN)) {
    if (!silent) set({ error: new FlowError('WRONG_NETWORK', `${target.name} does not support ${CLIENT_CONFIG.network}.`) })
    return
  }
  set({ status: 'connecting', error: null })
  try {
    const { accounts } = await (target.features as StandardConnectFeature)['standard:connect'].connect(silent ? { silent: true } : undefined)
    const chosen = pickAccount(accounts)
    if (!chosen) {
      set({ status: 'disconnected', error: silent ? null : new FlowError('WRONG_NETWORK', `No ${CLIENT_CONFIG.network} account was authorised in ${target.name}.`) })
      return
    }
    attach(target, chosen)
  } catch (error) {
    set({ status: 'disconnected', error: silent ? null : isUserRejection(error) ? new FlowError('WALLET_REJECTED', 'The connection request was declined.') : new FlowError('WALLET_NOT_FOUND', 'The wallet could not connect.') })
  }
}

export async function disconnect() {
  const feature = wallet ? (wallet.features as Partial<StandardDisconnectFeature>)['standard:disconnect'] : undefined
  try {
    window.localStorage.removeItem(REMEMBER_KEY)
  } catch {
    // Ignore storage errors.
  }
  detach()
  await feature?.disconnect().catch(() => undefined)
}

export function clearWalletError() {
  set({ error: null })
}

export async function refreshBalances() {
  const address = account?.address
  if (!address) return
  try {
    const lamports = await rpc.getBalance(address)
    let qforkRaw: bigint | null = null
    let qforkDecimals: number | null = null
    if (CLIENT_CONFIG.mint && (CLIENT_CONFIG.tokenStatus === 'LIVE' || CLIENT_CONFIG.network !== 'mainnet-beta')) {
      const holdings = await rpc.getHoldings(address, CLIENT_CONFIG.mint)
      qforkRaw = holdings.reduce((sum, item) => sum + item.amountRaw, 0n)
      qforkDecimals = holdings[0]?.decimals ?? (await rpc.getMint(CLIENT_CONFIG.mint))?.decimals ?? null
    }
    if (account?.address === address) set({ balances: { lamports, qforkRaw, qforkDecimals, loadedAt: Date.now(), error: null } })
  } catch {
    if (account?.address === address) set({ balances: { lamports: null, qforkRaw: null, qforkDecimals: null, loadedAt: Date.now(), error: 'Balances unavailable: RPC did not respond.' } })
  }
}

/** Signs without sending. Throws FlowError on rejection. `chain` defaults to the site's cluster. */
export async function signTransaction(transaction: Uint8Array, chain: `solana:${string}` = SOLANA_CHAIN): Promise<Uint8Array> {
  if (!wallet || !account) throw new FlowError('WALLET_NOT_FOUND', 'Connect a wallet first.')
  const feature = (wallet.features as Partial<SolanaSignTransactionFeature>)['solana:signTransaction']
  if (!feature) throw new FlowError('WALLET_NOT_FOUND', 'This wallet cannot sign transactions without sending them.')
  try {
    const [output] = await feature.signTransaction({ account, transaction, chain })
    return output.signedTransaction
  } catch (error) {
    if (isUserRejection(error)) throw new FlowError('WALLET_REJECTED')
    throw new FlowError('WALLET_REJECTED', 'The wallet returned an error while signing. Nothing was sent.')
  }
}

export function connectedAddress() {
  return account?.address ?? null
}

function init() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  const api = getWallets()
  const all = refreshOptions()
  api.on('register', () => {
    refreshOptions()
    trySilent()
  })
  api.on('unregister', () => {
    refreshOptions()
    if (wallet && !findWallet(wallet.name)) detach()
  })
  if (all.length) trySilent()
}

function trySilent() {
  if (state.status !== 'disconnected') return
  let remembered: string | null = null
  try {
    remembered = window.localStorage.getItem(REMEMBER_KEY)
  } catch {
    remembered = null
  }
  if (remembered && findWallet(remembered)) void connect(remembered, true)
}

export function useWallet() {
  useEffect(init, [])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
    () => state,
  )
}
