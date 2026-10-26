import { useCallback, useEffect, useState } from 'react'
import type { Hex } from 'viem'
import type { NetworkParams, NodeListing, SealedSpec } from '../protocol/nodes'
import { api, ApiError } from './api'

export interface DirectoryNode {
  id: string
  listing: NodeListing
  expiresAt: number
}

export interface NodeDirectory {
  descendant: { id: string; networkId: string; name: string; owner: Hex | null; eligible: boolean; params: NetworkParams }
  network: { spec: SealedSpec; genesisHash: Hex } | null
  nodes: DirectoryNode[]
}

export const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : (error as { code?: number })?.code === 4001 ? 'The wallet declined to sign.' : error instanceof Error ? error.message : 'Something went wrong.'

/** A descendant's signed node listings and sealed genesis. An empty id reads nothing. */
export function useNodeDirectory(id: string) {
  const [data, setData] = useState<NodeDirectory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!id) return
    let cancelled = false
    api<NodeDirectory>(`/api/nodes?descendant=${encodeURIComponent(id)}`, { timeoutMs: 10_000 })
      .then(({ data: body }) => !cancelled && (setData(body), setError(null)))
      .catch((caught) => !cancelled && setError(errorText(caught)))
    return () => {
      cancelled = true
    }
  }, [id, count])
  return { data, error, refresh: useCallback(() => setCount((value) => value + 1), []) }
}
