import type { AncestorId } from './ancestors.js'
import type { Chain } from './base.js'

export type VerificationStatus = 'VERIFIED' | 'PENDING' | 'REJECTED'

export interface BurnReceipt {
  id: string
  wallet: string
  mint: string
  /** Base units as a decimal string. */
  amountRaw: string
  decimals: number
  /** Whole QFORK required by the deployment. */
  amount: number
  signature: string
  slot: number | null
  timestamp: string
  purpose: 'GENESIS' | 'FORK'
  ancestor: AncestorId
  /** Chain the burn was verified on. Absent on receipts from before Base support, which are Solana. */
  chain?: Chain
  descendantId: string
  deploymentId: string
  network: string
  tokenProgram: string | null
  verificationStatus: VerificationStatus
  verifiedAt: string | null
  verifier: 'server'
}

export function descendantCode(sequence: number) {
  return `QF-${String(sequence).padStart(4, '0')}`
}
