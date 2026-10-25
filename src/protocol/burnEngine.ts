import type { Chain } from './base.js'
import type { BurnOperation } from './blueprints.js'
import type { DescendantConfig } from './descendant.js'
import { MODULE_BY_ID } from './modules.js'
import { type BurnLine, CHAIN_BURN_SCALE, PRICING, quoteGenesis } from './pricing.js'

export interface BurnOperationSpec {
  id: Exclude<BurnOperation, 'NONE'>
  code: string
  name: string
  output: string
  /** What the protocol can actually execute today. */
  status: 'TESTNET' | 'COMING SOON'
  detail: string
  /** Provisional base amount in whole QFORK; null when the operation is not priced. */
  base: number | null
}

export const BURN_OPERATIONS: BurnOperationSpec[] = [
  { id: 'GENESIS', code: 'RX-1', name: 'Registration', output: 'New descendant · GEN-1', status: 'TESTNET', detail: 'Registers a new descendant. Devnet test QFORK only until $QFORK launches.', base: PRICING.genesisBase },
  { id: 'FORK', code: 'RX-2', name: 'Fork', output: 'Descendant · GEN+1', status: 'COMING SOON', detail: 'Forks an existing descendant. Forks can be designed in the lab, but only registration burns are processed.', base: PRICING.forkBase },
  { id: 'MUTATION', code: 'RX-3', name: 'Mutation', output: 'Upgraded genome', status: 'COMING SOON', detail: 'Installs a module into a live descendant. Not implemented.', base: null },
  { id: 'APPLICATION_MODULE', code: 'RX-4', name: 'Application module', output: 'Application genome', status: 'COMING SOON', detail: 'Enables an application blueprint such as a vault. Not priced, because no application module exists.', base: null },
]

export const BURN_OPERATION_BY_ID = Object.fromEntries(BURN_OPERATIONS.map((item) => [item.id, item])) as Record<BurnOperationSpec['id'], BurnOperationSpec>

export interface BurnEstimate {
  operation: BurnOperation
  /** PROVISIONAL: computed from published provisional parameters. UNPRICED: no number exists. FREE: no burn. */
  basis: 'PROVISIONAL' | 'UNPRICED' | 'FREE'
  lines: BurnLine[]
  total: number | null
  note: string
}

/** Estimates the burn an operation would need. Pure: it never decides whether the burn can be executed. */
export function estimateBurn(operation: BurnOperation, config: DescendantConfig | null, chain: Chain = 'solana'): BurnEstimate {
  if (operation === 'NONE') return { operation, basis: 'FREE', lines: [], total: 0, note: 'No burn. Scanning and mapping are free.' }
  if ((operation === 'GENESIS' || operation === 'FORK') && config) {
    const quote = quoteGenesis(config, operation, chain)
    return { operation, basis: 'PROVISIONAL', lines: quote.lines, total: quote.total, note: 'Estimated from provisional parameters that may change before token launch.' }
  }
  if (operation === 'MUTATION' && config) {
    const lines = config.modules.map((id) => ({ label: `${MODULE_BY_ID[id].code} ${MODULE_BY_ID[id].name}`, amount: MODULE_BY_ID[id].burn * CHAIN_BURN_SCALE[chain] }))
    return { operation, basis: 'PROVISIONAL', lines, total: lines.reduce((sum, line) => sum + line.amount, 0), note: 'Module burns are provisional. Mutation is not implemented.' }
  }
  return { operation, basis: 'UNPRICED', lines: [], total: null, note: BURN_OPERATION_BY_ID[operation].detail }
}
