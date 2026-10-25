import { useEffect, useSyncExternalStore } from 'react'
import type { DeploymentRecord } from '../protocol/deployment'
import { type AncestorId, isAncestorId } from '../protocol/ancestors'
import { ancestorGenome, type DescendantConfig, toChainGenome } from '../protocol/descendant'
import { EXAMPLE_SPECS } from '../protocol/examples'
import type { BurnReceipt } from '../protocol/receipt'
import type { TokenRecord } from '../protocol/tokens'
import type { ChainGenome } from './genome'

export type Origin = 'ancestor' | 'example' | 'registered'

export interface Descendant {
  /** Route id: an ancestor (`base`, `solana`), `example-*`, or a server deployment id. */
  id: string
  code: string
  origin: Origin
  config: DescendantConfig | null
  parentId: string | null
  generation: number
  createdAt: string
  deployment: DeploymentRecord | null
  receipt: BurnReceipt | null
  tokens: TokenRecord[]
}

export const ORIGIN_LABEL: Record<Origin, string> = {
  ancestor: 'ANCESTOR',
  example: 'EXAMPLE DATA',
  registered: 'REGISTERED',
}

const root = (id: AncestorId, code: string, createdAt: string): Descendant => ({ id, code, origin: 'ancestor', config: null, parentId: null, generation: 0, createdAt, deployment: null, receipt: null, tokens: [] })

export const BASE_ROOT = root('base', 'ANCESTOR 001', '2023-08-09T00:00:00Z')
export const SOLANA_ROOT = root('solana', 'ANCESTOR 002', '2020-03-16T00:00:00Z')
export const ROOTS: Descendant[] = [BASE_ROOT, SOLANA_ROOT]

export const EXAMPLES: Descendant[] = EXAMPLE_SPECS.map((spec) => ({ ...spec, origin: 'example', createdAt: '2026-10-01T00:00:00Z', deployment: null, receipt: null, tokens: [] }))

interface Ref {
  id: string
  code: string
  config: DescendantConfig
  parentId: string
  generation: number
  createdAt: string
}

const KEY = 'qfork.registry.v2'
const LEGACY_KEY = 'qfork.registry.v1'

/** Only server-registered descendants are kept. Browser-only demo entries from older builds are dropped. */
function load(): Ref[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) return (JSON.parse(raw) as { registered: Ref[] }).registered ?? []
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const refs = ((JSON.parse(legacy) as { testnet?: Ref[] }).testnet ?? []).filter((ref) => /^dep_[a-z0-9]{16,32}$/.test(ref.id))
      window.localStorage.removeItem(LEGACY_KEY)
      return refs
    }
  } catch {
    // Private browsing: start empty.
  }
  return []
}

let saved: Ref[] = typeof window === 'undefined' ? [] : load()
let remote = new Map<string, { deployment: DeploymentRecord; receipt: BurnReceipt | null; tokens: TokenRecord[] }>()
let snapshot: Descendant[] = []
const listeners = new Set<() => void>()

function rebuild() {
  const registered: Descendant[] = saved.map((ref) => {
    const live = remote.get(ref.id)
    return { ...ref, origin: 'registered', deployment: live?.deployment ?? null, receipt: live?.receipt ?? null, tokens: live?.tokens ?? [] }
  })
  snapshot = [...ROOTS, ...EXAMPLES, ...registered]
  listeners.forEach((listener) => listener())
}
rebuild()

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ registered: saved }))
  } catch {
    // Persisting is best-effort.
  }
  rebuild()
}

export function useRegistry(tickMs = 0) {
  useEffect(() => {
    if (!tickMs) return
    const id = window.setInterval(rebuild, tickMs)
    return () => window.clearInterval(id)
  }, [tickMs])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
    () => snapshot,
  )
}

export function registrySnapshot() {
  return snapshot
}

export function findDescendant(all: Descendant[], id: string) {
  return all.find((item) => item.id === id) ?? null
}

export function childrenOf(all: Descendant[], id: string) {
  return all.filter((item) => item.parentId === id)
}

export function lineage(all: Descendant[], id: string) {
  const chain: Descendant[] = []
  let current = findDescendant(all, id)
  while (current) {
    chain.unshift(current)
    current = current.parentId ? findDescendant(all, current.parentId) : null
  }
  return chain
}

const genomeCache = new Map<string, ChainGenome>()

/** The ancestor a registry entry descends from: its own id for a root, otherwise its config's ancestor. */
export function ancestorOf(item: Descendant): AncestorId {
  if (item.config) return item.config.ancestor
  return isAncestorId(item.id) ? item.id : 'base'
}

/** Visual organism for any registry entry. Ancestors use their own genome. */
export function genomeOf(item: Descendant): ChainGenome {
  if (!item.config) return ancestorGenome(ancestorOf(item))
  const key = `${item.id}:${item.generation}:${JSON.stringify(item.config)}`
  let genome = genomeCache.get(key)
  if (!genome) {
    genome = toChainGenome(item.config, item.generation, item.parentId)
    genomeCache.set(key, genome)
  }
  return genome
}

export function rememberRegistered(deployment: DeploymentRecord, parentId: string = deployment.config.ancestor, generation = 1) {
  if (saved.some((ref) => ref.id === deployment.id)) return
  saved = [...saved, { id: deployment.id, code: deployment.descendantId, config: deployment.config, parentId, generation, createdAt: deployment.createdAt }]
  remote = new Map(remote).set(deployment.id, { deployment, receipt: null, tokens: [] })
  persist()
}

export function updateRemote(deployment: DeploymentRecord, receipt: BurnReceipt | null, tokens?: TokenRecord[]) {
  const previous = remote.get(deployment.id)
  remote = new Map(remote).set(deployment.id, { deployment, receipt, tokens: tokens ?? previous?.tokens ?? [] })
  rebuild()
}

export function addToken(token: TokenRecord) {
  const previous = remote.get(token.deploymentId)
  if (!previous || previous.tokens.some((item) => item.mint === token.mint)) return
  remote = new Map(remote).set(token.deploymentId, { ...previous, tokens: [token, ...previous.tokens] })
  rebuild()
}

/** Adds server-registered descendants created elsewhere. */
export function mergeServerDescendants(list: { id: string; descendantId: string; config: DescendantConfig; createdAt: string }[]) {
  let changed = false
  for (const item of list) {
    if (saved.some((ref) => ref.id === item.id)) continue
    saved = [...saved, { id: item.id, code: item.descendantId, config: item.config, parentId: item.config.ancestor, generation: 1, createdAt: item.createdAt }]
    changed = true
  }
  if (changed) persist()
}

export function findReceipt(all: Descendant[], id: string) {
  return all.find((item) => item.receipt?.id === id)?.receipt ?? null
}
