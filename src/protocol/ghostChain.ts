/**
 * Ghost Chains are temporary EVM networks. This module is the lifecycle only.
 * It does not start a process. A provider does that, and only on a local machine.
 */

export const GHOST_SPEC = 'qfork/ghost-chain/v1'
export const GHOST_LIFETIMES = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
} as const
export type GhostLifetime = keyof typeof GHOST_LIFETIMES
export type GhostStatus = 'CREATING' | 'RUNNING' | 'EXPIRING' | 'TERMINATED' | 'FAILED'

export interface GhostRecord {
  id: string
  chainId: number
  port: number
  lifetime: GhostLifetime
  status: GhostStatus
  createdAt: number
  expiresAt: number
  error: string | null
}

export function isLifetime(value: string): value is GhostLifetime {
  return value in GHOST_LIFETIMES
}

export function createRecord(input: { id: string; chainId: number; port: number; lifetime: GhostLifetime; now: number }): GhostRecord {
  if (!isLifetime(input.lifetime)) throw new Error('Lifetime must be 15m, 1h, 6h, or 24h.')
  if (!Number.isInteger(input.chainId) || input.chainId < 1) throw new Error('Chain id has to be a positive integer.')
  return {
    id: input.id,
    chainId: input.chainId,
    port: input.port,
    lifetime: input.lifetime,
    status: 'CREATING',
    createdAt: input.now,
    expiresAt: input.now + GHOST_LIFETIMES[input.lifetime],
    error: null,
  }
}

/** Pure transition. Unknown events and illegal moves throw, so a provider cannot skip cleanup. */
export function transition(record: GhostRecord, event: 'started' | 'fail' | 'expire' | 'terminate' | 'stopped', now: number, error?: string): GhostRecord {
  const next = { ...record }
  if (event === 'expire' && now < record.expiresAt) throw new Error('This environment has not reached its expiry.')
  if (record.status === 'TERMINATED') throw new Error('A terminated environment stays terminated.')
  if (event === 'started' && record.status === 'CREATING') next.status = 'RUNNING'
  else if (event === 'fail' && (record.status === 'CREATING' || record.status === 'RUNNING')) {
    next.status = 'FAILED'
    next.error = error ?? 'The environment failed.'
  } else if ((event === 'expire' || event === 'terminate') && (record.status === 'RUNNING' || record.status === 'FAILED' || record.status === 'CREATING')) next.status = 'EXPIRING'
  else if (event === 'stopped' && (record.status === 'EXPIRING' || record.status === 'FAILED')) next.status = 'TERMINATED'
  else throw new Error(`Cannot ${event} an environment that is ${record.status}.`)
  return next
}

export function remainingMs(record: GhostRecord, now: number) {
  if (record.status === 'TERMINATED' || record.status === 'FAILED') return 0
  return Math.max(0, record.expiresAt - now)
}
