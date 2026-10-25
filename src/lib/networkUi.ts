import { useEffect, useMemo, useState } from 'react'
import { CLIENT_CONFIG } from '../config'
import { childrenOf, type Descendant, findDescendant, updateRemote, useRegistry } from '../lab/registry'
import { fetchRemoteDeployment } from '../lab/testnet'
import { navigate } from '../navigation'
import { FlowError } from './failures'
import { useEvmWallet } from './evm/wallet'
import { useWallet } from './solana/wallet'
import type { Chain } from '../protocol/base'
import { type DescendantConfig, toChainGenome } from '../protocol/descendant'
import type { DevKitInput, KitCluster } from '../protocol/devKit'
import { latticeFor, type LayerSpec, networkLayers } from '../protocol/networkLayers'
import type { TokenRecord } from '../protocol/tokens'

export type NetworkTab = 'overview' | 'tokens' | 'developers' | 'cryptography'

export const NETWORK_TABS: { id: NetworkTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'developers', label: 'Developers' },
  { id: 'cryptography', label: 'Cryptography' },
]

export function isNetworkTab(value: string | undefined): value is NetworkTab {
  return NETWORK_TABS.some((tab) => tab.id === value)
}

/** A registered descendant as the console shows it: only what the server and the chain recorded. */
export interface ConsoleView {
  id: string
  code: string
  config: DescendantConfig
  descendant: Descendant
  /** Chain the registration burn happened on; tokens launch on the same chain. */
  chain: Chain
  /** Network of the registration burn (a Solana cluster or a Base network). */
  network: string
  cluster: KitCluster
  registeredAt: string | null
  tokens: TokenRecord[]
  forks: Descendant[]
  layers: LayerSpec[]
  lattice: number
  /** The connected wallet is the one that burned for this descendant. */
  owned: boolean
  devKit: DevKitInput
}

export interface TabProps {
  view: ConsoleView
  launch: () => void
}

export const networkHref = (id: string, tab: NetworkTab = 'overview') => (tab === 'overview' ? `/network/${id}` : `/network/${id}/${tab}`)

export function buildConsoleView(descendant: Descendant, registry: Descendant[], wallet: string | null, evmWallet: string | null = null): ConsoleView | null {
  if (descendant.origin !== 'registered' || !descendant.config) return null
  const config = descendant.config
  const chain: Chain = descendant.receipt?.chain ?? descendant.deployment?.burn.chain ?? 'solana'
  const cluster = (chain === 'base' ? CLIENT_CONFIG.network : (descendant.receipt?.network ?? descendant.deployment?.burn.network ?? CLIENT_CONFIG.network)) as KitCluster
  const owner = descendant.receipt?.wallet ?? null
  const owned = chain === 'base' ? Boolean(evmWallet && owner && owner.toLowerCase() === evmWallet.toLowerCase()) : Boolean(wallet && owner === wallet)
  const registeredAt = descendant.deployment?.history.find((entry) => entry.state === 'REGISTERED')?.at ?? null
  const forks = childrenOf(registry, descendant.id)
  const tokens = descendant.tokens
  return {
    id: descendant.id,
    code: descendant.code,
    config,
    descendant,
    chain,
    network: descendant.receipt?.network ?? descendant.deployment?.burn.network ?? CLIENT_CONFIG.network,
    cluster,
    registeredAt,
    tokens,
    forks,
    layers: networkLayers(descendant.id, config, tokens, forks.length),
    lattice: latticeFor(config),
    owned,
    devKit: {
      id: descendant.id,
      code: descendant.code,
      config,
      generation: descendant.generation,
      parent: descendant.parentId ?? config.ancestor,
      registeredAt,
      chain,
      cluster,
      baseNetwork: (chain === 'base' ? (descendant.receipt?.network ?? descendant.deployment?.burn.network) : null) === 'base' ? 'base' : 'base-sepolia',
      burnSignature: descendant.receipt?.signature ?? null,
      tokens: tokens.flatMap((token) => ((token.cluster === 'base' || token.cluster === 'base-sepolia') === (chain === 'base') ? [{ name: token.name, symbol: token.symbol, decimals: token.decimals, mint: token.mint, kind: token.kind, cluster: token.cluster }] : [])),
      siteUrl: CLIENT_CONFIG.siteUrl,
    },
  }
}

/** A registered descendant by route id, refreshed from the server so its tokens are current. */
export function useNetwork(id: string) {
  const registry = useRegistry()
  const wallet = useWallet()
  const evm = useEvmWallet()
  const local = findDescendant(registry, id)
  const [fetched, setFetched] = useState<Descendant | null>(null)
  const [error, setError] = useState<FlowError | null>(null)
  const [refreshed, setRefreshed] = useState(0)

  useEffect(() => {
    if (!id.startsWith('dep_')) return
    let cancelled = false
    fetchRemoteDeployment(id)
      .then((data) => {
        if (cancelled) return
        updateRemote(data.deployment, data.receipt, data.tokens ?? [])
        setFetched({
          id,
          code: data.deployment.descendantId,
          origin: 'registered',
          config: data.deployment.config,
          parentId: data.deployment.config.ancestor,
          generation: 1,
          createdAt: data.deployment.createdAt,
          deployment: data.deployment,
          receipt: data.receipt,
          tokens: data.tokens ?? [],
        })
      })
      .catch((caught) => !cancelled && setError(caught instanceof FlowError ? caught : new FlowError('API_UNAVAILABLE')))
    return () => {
      cancelled = true
    }
  }, [id, refreshed])

  const descendant = local?.deployment ? local : (fetched ?? local)
  const view = useMemo(() => (descendant ? buildConsoleView(descendant, registry, wallet.address, evm.address) : null), [descendant, registry, wallet.address, evm.address])
  return { descendant, view, error, loading: !descendant && id.startsWith('dep_') && !error, refresh: () => setRefreshed((count) => count + 1) }
}

export function downloadFile(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Scrolls to the element named by the URL hash, once the tab has rendered. */
export function scrollToHash() {
  const hash = window.location.hash.slice(1)
  if (!hash) return
  window.requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

/** Navigates within the console, honouring a #hash target. */
export function goTo(href: string) {
  navigate(href, { keepScroll: href.includes('#') })
  scrollToHash()
}

export function useHashScroll() {
  useEffect(scrollToHash, [])
}

export function useNetworkGenome(view: ConsoleView) {
  const { config, descendant } = view
  return useMemo(() => toChainGenome(config, descendant.generation, descendant.parentId), [config, descendant.generation, descendant.parentId])
}

export const timestamp = (iso: string | null) => (iso ? `${iso.replace('T', ' ').slice(0, 19)} UTC` : '—')
