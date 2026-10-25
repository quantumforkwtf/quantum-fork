import type { Chain } from './base.js'
import type { DeploymentTier, DescendantConfig } from './descendant.js'

export type DeploymentState = 'DRAFT' | 'VALIDATED' | 'AWAITING_BURN' | 'BURN_SUBMITTED' | 'BURN_CONFIRMED' | 'REGISTERED' | 'BURN_FAILED'

export const HAPPY_PATH: DeploymentState[] = ['DRAFT', 'VALIDATED', 'AWAITING_BURN', 'BURN_SUBMITTED', 'BURN_CONFIRMED', 'REGISTERED']

export const FAILURE_STATES: DeploymentState[] = ['BURN_FAILED']

const TRANSITIONS: Record<DeploymentState, DeploymentState[]> = {
  DRAFT: ['VALIDATED'],
  VALIDATED: ['AWAITING_BURN'],
  AWAITING_BURN: ['BURN_SUBMITTED'],
  BURN_SUBMITTED: ['BURN_CONFIRMED', 'BURN_FAILED'],
  BURN_FAILED: ['AWAITING_BURN'],
  BURN_CONFIRMED: ['REGISTERED'],
  REGISTERED: [],
}

export const STATE_LABEL: Record<DeploymentState, string> = {
  DRAFT: 'Draft',
  VALIDATED: 'Configuration validated',
  AWAITING_BURN: 'Awaiting burn',
  BURN_SUBMITTED: 'Burn submitted',
  BURN_CONFIRMED: 'Burn verified on-chain',
  REGISTERED: 'Descendant registered',
  BURN_FAILED: 'Burn failed',
}

export function canTransition(from: DeploymentState, to: DeploymentState) {
  return TRANSITIONS[from].includes(to)
}

export class TransitionError extends Error {
  constructor(
    readonly from: DeploymentState,
    readonly to: DeploymentState,
  ) {
    super(`Invalid deployment transition ${from} → ${to}`)
    this.name = 'TransitionError'
  }
}

export interface BurnBinding {
  /** Chain the burn happens on. Records created before Base support have no value and are Solana. */
  chain?: Chain
  /** Whole QFORK required, computed by the protocol, never by the client. */
  required: number
  mint: string | null
  network: string | null
  memo: string
  signature: string | null
  receiptId: string | null
}

export interface HistoryItem {
  state: DeploymentState
  at: string
  note?: string
}

export interface DeploymentRecord {
  id: string
  correlationId: string
  createdAt: string
  updatedAt: string
  state: DeploymentState
  enteredAt: string
  tier: DeploymentTier
  config: DescendantConfig
  genomeHash: string
  descendantId: string
  burn: BurnBinding
  history: HistoryItem[]
  error: { code: string; message: string } | null
  /** Optimistic concurrency guard; incremented on every write. */
  version: number
}

export function transition(record: DeploymentRecord, to: DeploymentState, now: Date, note?: string): DeploymentRecord {
  if (!canTransition(record.state, to)) throw new TransitionError(record.state, to)
  const at = now.toISOString()
  return {
    ...record,
    state: to,
    enteredAt: at,
    updatedAt: at,
    history: [...record.history, { state: to, at, note }],
    error: FAILURE_STATES.includes(to) ? record.error : null,
    version: record.version + 1,
  }
}

/** The label for a deployment state, naming the network the burn was verified on. */
export function stateLabel(state: DeploymentState, network?: string | null): string {
  if (state === 'BURN_CONFIRMED' && network) return `Burn verified · ${network}`
  return STATE_LABEL[state]
}

export function isTerminalSuccess(state: DeploymentState) {
  return state === 'REGISTERED'
}

export function isFailure(state: DeploymentState) {
  return FAILURE_STATES.includes(state)
}

/** Memo committed inside the burn transaction; binds the burn to one deployment. */
export function burnMemo(deploymentId: string, purpose: 'genesis' | 'fork' = 'genesis') {
  return `qfork:v1:${purpose}:${deploymentId}`
}

export function parseBurnMemo(memo: string) {
  const match = memo.match(/^qfork:v1:(genesis|fork):(dep_[a-z0-9]{16,32})$/)
  return match ? { purpose: match[1] as 'genesis' | 'fork', deploymentId: match[2] } : null
}

export function newDeploymentId(random: () => string) {
  return `dep_${random()}`
}
