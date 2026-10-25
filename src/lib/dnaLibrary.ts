import { useSyncExternalStore } from 'react'
import { type ChainDna, parseDna } from '../protocol/chainDna'

/** Saved Chain DNA, kept in this browser only. Publishing to the server is a separate, explicit step. */
export interface SavedDna {
  id: string
  savedAt: string
  dna: ChainDna
}

const KEY = 'qfork.dna.library.v1'
const MAX = 50
const listeners = new Set<() => void>()
let cache: SavedDna[] | null = null

function read(): SavedDna[] {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    cache = Array.isArray(raw)
      ? raw.flatMap((item) => {
          const entry = item as Partial<SavedDna>
          const parsed = parseDna(entry.dna)
          return typeof entry.id === 'string' && typeof entry.savedAt === 'string' && parsed.ok ? [{ id: entry.id, savedAt: entry.savedAt, dna: parsed.dna }] : []
        })
      : []
  } catch {
    cache = []
  }
  return cache
}

function write(entries: SavedDna[]) {
  cache = entries.slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Storage full or disabled: the in-memory copy still serves this tab.
  }
  listeners.forEach((listener) => listener())
}

const newId = () => `dna_${Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`

export function saveDna(dna: ChainDna, id?: string): SavedDna {
  const entry = { id: id ?? newId(), savedAt: new Date().toISOString(), dna }
  write([entry, ...read().filter((item) => item.id !== entry.id)])
  return entry
}

export function duplicateDna(id: string): SavedDna | null {
  const source = read().find((item) => item.id === id)
  if (!source) return null
  const name = `${source.dna.name} copy`.slice(0, 40)
  return saveDna({ ...structuredClone(source.dna), name })
}

export function removeDna(id: string) {
  write(read().filter((item) => item.id !== id))
}

export function useDnaLibrary(): SavedDna[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
    () => [],
  )
}
