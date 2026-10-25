import { PALETTE, type PqProfile as GenomeProfile } from '../lab/genome.js'
import { type AncestorId, DEFAULT_ANCESTOR } from './ancestors.js'
import { type PqModuleId, withDependencies } from './modules.js'

export type ProfileId = 'hybrid' | 'pq-forward' | 'research' | 'custom'

export interface PqProfile {
  id: ProfileId
  code: string
  name: string
  summary: string
  optimizes: string
  retains: string
  tradeoffs: string[]
  modules: PqModuleId[]
  color: string
  /** Shape of the organism's nucleus and rings for this profile. */
  morphology: GenomeProfile
  warning?: string
  experimental?: boolean
}

export const PQ_PROFILES: PqProfile[] = [
  {
    id: 'hybrid',
    code: 'PROFILE 01',
    name: 'HYBRID',
    summary: 'Classical and post-quantum signatures side by side. Both must verify.',
    optimizes: 'Migration and compatibility',
    retains: 'secp256k1 ECDSA on every signature, so security holds if either scheme holds',
    tradeoffs: [
      'Largest transactions of any profile: every signer carries two signatures.',
      'Existing tooling keeps working through the migration window.',
      'Sequencer identity and settlement stay classical.',
    ],
    modules: ['cag', 'hsp', 'pqk', 'pqr', 'wcl', 'pqt'],
    color: PALETTE.yellow,
    morphology: 'hybrid',
  },
  {
    id: 'pq-forward',
    code: 'PROFILE 02',
    name: 'PQ FORWARD',
    summary: 'Hybrid accounts plus post-quantum sequencer identity, recovery and bridge rules.',
    optimizes: 'Breadth of post-quantum coverage',
    retains: 'secp256k1 ECDSA for wallet compatibility; settlement on Ethereum stays classical',
    tradeoffs: [
      'Node-breaking: every node upgrades together.',
      'Classical-only bridges are refused.',
      'Larger blocks on the P2P network.',
    ],
    modules: ['cag', 'hsp', 'pqk', 'pqr', 'vid', 'wcl', 'bmp', 'pqt'],
    color: PALETTE.lime,
    morphology: 'hybrid',
  },
  {
    id: 'research',
    code: 'PROFILE 03',
    name: 'RESEARCH',
    summary: 'Lattice-only signatures and post-quantum privacy. For experiments, not assets.',
    optimizes: 'Exploring a fully post-quantum stack',
    retains: 'Nothing classical in account authorization',
    tradeoffs: [
      'No classical fallback if the lattice scheme or implementation fails.',
      'Incompatible with every existing EVM wallet.',
      'Proof systems are not standardized.',
    ],
    modules: ['cag', 'lsp', 'pqk', 'pqr', 'vid', 'spq', 'pqt'],
    color: PALETTE.red,
    morphology: 'experimental',
    warning: 'NOT FOR PRODUCTION ASSETS',
    experimental: true,
  },
  {
    id: 'custom',
    code: 'PROFILE 04',
    name: 'CUSTOM',
    summary: 'Expert mode. Choose individual modules; dependencies are added automatically.',
    optimizes: 'Whatever you decide',
    retains: 'Depends on your selection',
    tradeoffs: ['You are responsible for the combination.', 'Unusual combinations receive the least review.'],
    modules: ['cag', 'hsp', 'pqk'],
    color: PALETTE.cyan,
    morphology: 'hybrid',
  },
]

export const PROFILE_BY_ID = Object.fromEntries(PQ_PROFILES.map((profile) => [profile.id, profile])) as Record<ProfileId, PqProfile>

type ProfileText = Partial<Pick<PqProfile, 'summary' | 'retains' | 'tradeoffs'>>

const SOLANA_TEXT: Partial<Record<ProfileId, ProfileText>> = {
  hybrid: {
    retains: 'Ed25519 on every signature, so security holds if either scheme holds',
    tradeoffs: ['Largest transactions of any profile: every signer carries two signatures.', 'Existing tooling keeps working through the migration window.', 'Validator identity and consensus stay classical.'],
  },
  'pq-forward': {
    summary: 'Hybrid accounts plus post-quantum validator identity, recovery and bridge rules.',
    retains: 'Ed25519 for account compatibility; BLS certificates for consensus speed',
    tradeoffs: ['Consensus-breaking: every validator upgrades together.', 'Classical-only bridges are refused.', 'Higher bandwidth for gossip and votes.'],
  },
  research: {
    tradeoffs: ['No classical fallback if the lattice scheme or implementation fails.', 'Incompatible with every existing Solana wallet.', 'Proof systems are not standardized.'],
  },
}

const ANCESTOR_TEXT: Record<AncestorId, Partial<Record<ProfileId, ProfileText>>> = { base: {}, solana: SOLANA_TEXT }

/** A profile as it applies to one ancestor's descendants. */
export function profileFor(id: ProfileId, ancestor: AncestorId = DEFAULT_ANCESTOR): PqProfile {
  return { ...PROFILE_BY_ID[id], ...ANCESTOR_TEXT[ancestor][id] }
}

/** "HYBRID PQ", "PQ FORWARD", "RESEARCH PQ": the strain label used on reports and share cards. */
export function strainLabel(profile: Pick<PqProfile, 'name'>) {
  return profile.name.includes('PQ') ? profile.name : `${profile.name} PQ`
}

export function profileModules(id: ProfileId) {
  return withDependencies(PROFILE_BY_ID[id].modules)
}
