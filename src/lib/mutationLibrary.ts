import { useSyncExternalStore } from 'react'
import { type Lineage, parseLineage } from '../protocol/mutation'

/** Evolution trees, kept in this browser only. Recording a branch does not deploy it. */
const KEY = 'qfork.mutation.v1'
const MAX = 8
const listeners = new Set<() => void>()
let cache: Lineage[] | null = null

function read(): Lineage[] {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    cache = Array.isArray(raw) ? raw.flatMap((item) => { const parsed = parseLineage(item); return parsed ? [parsed] : [] }) : []
  } catch {
    cache = []
  }
  return cache
}

function write(entries: Lineage[]) {
  cache = entries.slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Storage full or disabled: the in-memory copy still serves this tab.
  }
  listeners.forEach((listener) => listener())
}

export function saveLineage(lineage: Lineage) {
  write([lineage, ...read().filter((item) => item.id !== lineage.id)])
}

export function removeLineage(id: string) {
  write(read().filter((item) => item.id !== id))
}

export function useLineages(): Lineage[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
    () => [],
  )
}
