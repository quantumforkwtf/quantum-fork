import { hexDigest, stableStringify } from '../lib/random.js'

export type Vm = 'svm' | 'evm' | 'move' | 'wasm'
export type BlockTime = 2000 | 1000 | 400
export type Privacy = 'public' | 'shielded' | 'private-first'
export type PqProfile = 'classical' | 'hybrid' | 'experimental'
export type Recovery = 'none' | 'multisig' | 'threshold' | 'deadman'
export type GasModel = 'fixed' | 'dynamic'
export type ModuleId = 'bridge' | 'oracle' | 'governance' | 'names' | 'dex'
export type MutationId =
  | 'quantum-shield'
  | 'dark-state'
  | 'deadman-gene'
  | 'turbo-gene'
  | 'validator-gene'
  | 'fee-gene'
  | 'lattice-core'

export const GENOME_SPEC = 'qfork/genome/v0.2'

export interface ChainGenome {
  spec: typeof GENOME_SPEC
  identity: {
    name: string
    ticker: string
    supply: number
  }
  execution: {
    vm: Vm
    blockTimeMs: BlockTime
    validators: number
    modules: ModuleId[]
  }
  privacy: Privacy
  cryptography: {
    profile: PqProfile
  }
  economics: {
    gas: GasModel
    baseFeeMicros: number
    treasuryPct: number
    burnPct: number
  }
  recovery: Recovery
  lineage: {
    family: string
    generation: number
    parent: string | null
    mutations: MutationId[]
  }
}

export interface Choice<T extends string | number> {
  value: T
  label: string
  detail: string
  color?: string
}

export const PALETTE = {
  ink: '#16130F',
  charcoal: '#25221E',
  graphite: '#3B3833',
  steel: '#9AA3AD',
  paper: '#F1EADB',
  bone: '#FBF7EE',
  lime: '#C8FF4D',
  green: '#3DFFA0',
  cyan: '#4FE3FF',
  orange: '#FF7A3C',
  purple: '#9D7BFF',
  pink: '#FF5FA8',
  yellow: '#FFD54A',
  red: '#FF4D5E',
} as const

export const vmChoices: Choice<Vm>[] = [
  { value: 'svm', label: 'SVM', detail: 'Solana Virtual Machine · parallel execution' },
  { value: 'evm', label: 'EVM', detail: 'Ethereum Virtual Machine · Solidity contracts' },
  { value: 'move', label: 'MOVEVM', detail: 'Resource-oriented Move contracts' },
  { value: 'wasm', label: 'WASM', detail: 'WebAssembly runtime · Rust and C++' },
]

export const blockTimeChoices: Choice<BlockTime>[] = [
  { value: 2000, label: 'STANDARD', detail: '2.0s blocks · modest validator hardware' },
  { value: 1000, label: 'FAST', detail: '1.0s blocks · balanced profile' },
  { value: 400, label: 'TURBO', detail: '0.4s blocks · high-spec validators', color: PALETTE.orange },
]

export const privacyChoices: Choice<Privacy>[] = [
  { value: 'public', label: 'PUBLIC', detail: 'Transparent ledger. The nucleus is fully exposed.', color: PALETTE.green },
  { value: 'shielded', label: 'SHIELDED', detail: 'Shielded transfers available beside public ones.', color: PALETTE.purple },
  { value: 'private-first', label: 'PRIVATE-FIRST', detail: 'Every transfer shielded. No transparent path.', color: PALETTE.purple },
]

export const pqChoices: Choice<PqProfile>[] = [
  { value: 'classical', label: 'CLASSICAL', detail: 'Ed25519. Well understood. Not quantum-resistant.', color: PALETTE.cyan },
  { value: 'hybrid', label: 'HYBRID', detail: 'Ed25519 + ML-DSA-65. Both signatures required.', color: PALETTE.yellow },
  { value: 'experimental', label: 'EXPERIMENTAL PQ', detail: 'Pure post-quantum suite. Research networks only.', color: PALETTE.red },
]

export const recoveryChoices: Choice<Recovery>[] = [
  { value: 'none', label: 'NONE', detail: 'Owner keys only. Lose them, lose the account.' },
  { value: 'multisig', label: 'MULTISIG', detail: '2-of-3 keys can authorize a key rotation.' },
  { value: 'threshold', label: 'THRESHOLD', detail: '3-of-5 guardians can rotate a lost key.' },
  { value: 'deadman', label: 'DEADMAN', detail: 'After 180 days of owner silence, guardians may recover.' },
]

export const gasChoices: Choice<GasModel>[] = [
  { value: 'fixed', label: 'FIXED', detail: 'Flat fee per transaction' },
  { value: 'dynamic', label: 'DYNAMIC', detail: 'Fee rises with block demand' },
]

export const moduleChoices: Choice<ModuleId>[] = [
  { value: 'bridge', label: 'BRIDGE', detail: 'Canonical asset bridge to Solana' },
  { value: 'oracle', label: 'ORACLE', detail: 'Price and data feeds' },
  { value: 'governance', label: 'GOVERNANCE', detail: 'On-chain proposals and voting' },
  { value: 'names', label: 'NAME SERVICE', detail: 'Human-readable addresses' },
  { value: 'dex', label: 'NATIVE DEX', detail: 'Protocol-level order book' },
]

export const MODULE_IDS = moduleChoices.map((choice) => choice.value)

export function tickerFrom(name: string) {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return (letters.slice(0, 4) || 'SPEC').padEnd(3, 'X')
}

export function familyFrom(name: string) {
  return name.trim().toUpperCase().split(/\s+/)[0] || 'UNNAMED'
}

export function createGenome(name = 'NOVA'): ChainGenome {
  return {
    spec: GENOME_SPEC,
    identity: { name, ticker: tickerFrom(name), supply: 1_000_000_000 },
    execution: { vm: 'svm', blockTimeMs: 1000, validators: 24, modules: ['bridge'] },
    privacy: 'public',
    cryptography: { profile: 'classical' },
    economics: { gas: 'dynamic', baseFeeMicros: 50, treasuryPct: 10, burnPct: 25 },
    recovery: 'none',
    lineage: { family: familyFrom(name), generation: 0, parent: null, mutations: [] },
  }
}

export function fingerprint(genome: ChainGenome) {
  return `0x${hexDigest(stableStringify(genome), 4)}`
}

export function shortFingerprint(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function choiceLabel<T extends string | number>(choices: Choice<T>[], value: T) {
  return choices.find((choice) => choice.value === value)?.label ?? String(value)
}

export interface CryptoDetails {
  signature: string
  hash: string
  proof: string
  keys: string
  recovery: string
  pq: string
  notes: string[]
}

export function cryptoDetails(genome: ChainGenome): CryptoDetails {
  const profile = genome.cryptography.profile
  const shielded = genome.privacy !== 'public'
  const notes: string[] = []

  const signature =
    profile === 'classical'
      ? 'Ed25519'
      : profile === 'hybrid'
        ? 'Ed25519 + ML-DSA-65'
        : 'ML-DSA-87 · SLH-DSA fallback'
  const hash =
    profile === 'classical' ? 'SHA-256' : profile === 'hybrid' ? 'SHA3-256' : 'SHAKE256'
  const keys =
    profile === 'classical'
      ? 'Single Ed25519 keypair'
      : profile === 'hybrid'
        ? 'Dual keypair · both must sign'
        : 'ML-KEM-768 + ML-DSA keys'
  const proof = !shielded
    ? 'None · transparent ledger'
    : profile === 'classical'
      ? 'Groth16 · BN254'
      : profile === 'hybrid'
        ? 'PLONK · classical curve'
        : 'STARK · hash-based'
  const pq =
    profile === 'classical'
      ? 'None · classical only'
      : profile === 'hybrid'
        ? 'Hybrid · FIPS 204 signatures'
        : 'Experimental · full PQ stack'
  const recovery = {
    none: 'Owner only',
    multisig: '2-of-3 multisig rotation',
    threshold: '3-of-5 guardian threshold',
    deadman: 'Deadman · 180-day inactivity trigger',
  }[genome.recovery]

  if (profile === 'hybrid' && shielded) {
    notes.push('Shielded proofs remain classical in the hybrid profile.')
  }
  if (profile === 'experimental') {
    notes.push('Experimental profile: not suitable for value-bearing networks.')
  }
  if (profile === 'classical') {
    notes.push('Classical signatures can be forged by a large quantum computer.')
  }

  return { signature, hash, proof, keys, recovery, pq, notes }
}

const WEIGHTS = {
  privacy: 9.4,
  pq: 11.7,
  recovery: 6.3,
  vm: 17.2,
  blockTime: 5.6,
  validators: 8.1,
  gas: 2.4,
  baseFee: 2.2,
  treasury: 3.3,
  burn: 3.9,
  module: 2.9,
  name: 1.6,
}

const MAX_WEIGHT =
  WEIGHTS.privacy +
  WEIGHTS.pq +
  WEIGHTS.recovery +
  WEIGHTS.vm +
  WEIGHTS.blockTime +
  WEIGHTS.validators +
  WEIGHTS.gas +
  WEIGHTS.baseFee +
  WEIGHTS.treasury +
  WEIGHTS.burn +
  WEIGHTS.module * MODULE_IDS.length +
  WEIGHTS.name

export function divergence(a: ChainGenome, b: ChainGenome) {
  let score = 0
  if (a.privacy !== b.privacy) score += WEIGHTS.privacy
  if (a.cryptography.profile !== b.cryptography.profile) score += WEIGHTS.pq
  if (a.recovery !== b.recovery) score += WEIGHTS.recovery
  if (a.execution.vm !== b.execution.vm) score += WEIGHTS.vm
  if (a.execution.blockTimeMs !== b.execution.blockTimeMs) score += WEIGHTS.blockTime
  score +=
    (Math.abs(a.execution.validators - b.execution.validators) / 128) * WEIGHTS.validators
  if (a.economics.gas !== b.economics.gas) score += WEIGHTS.gas
  score +=
    Math.min(Math.abs(a.economics.baseFeeMicros - b.economics.baseFeeMicros) / 500, 1) *
    WEIGHTS.baseFee
  score += (Math.abs(a.economics.treasuryPct - b.economics.treasuryPct) / 30) * WEIGHTS.treasury
  score += (Math.abs(a.economics.burnPct - b.economics.burnPct) / 100) * WEIGHTS.burn
  for (const module of MODULE_IDS) {
    if (a.execution.modules.includes(module) !== b.execution.modules.includes(module)) {
      score += WEIGHTS.module
    }
  }
  if (a.identity.name !== b.identity.name) score += WEIGHTS.name
  return Math.round((score / MAX_WEIGHT) * 1000) / 10
}

export function toManifest(genome: ChainGenome) {
  return {
    ...genome,
    fingerprint: fingerprint(genome),
    derived: cryptoDetails(genome),
    status: 'design-manifest',
    note: 'Design manifest only. Not deployable without a reference implementation.',
  }
}
