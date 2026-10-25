import type { FindingStatus } from '../protocol/ancestors'
import type { ModuleStatus } from '../protocol/modules'

export const FINDING_TONE: Record<FindingStatus, string> = {
  EXPOSED: 'var(--red)',
  'EXTERNAL DEPENDENCY': 'var(--orange)',
  EXPERIMENTAL: 'var(--purple)',
  'MIGRATION AVAILABLE': 'var(--lime)',
  REVIEWED: 'var(--green)',
  UNKNOWN: 'var(--yellow)',
  'NOT APPLICABLE': 'var(--faint)',
}

export const MODULE_TONE: Record<ModuleStatus, string> = {
  PRODUCTION: 'var(--green)',
  TESTNET: 'var(--cyan)',
  EXPERIMENTAL: 'var(--purple)',
  RESEARCH: 'var(--yellow)',
  'COMING SOON': 'var(--muted)',
}
