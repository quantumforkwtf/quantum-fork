import { PALETTE } from '../lab/genome.js'
import type { OrganPart } from '../lab/morphology.js'
import { type AncestorId, type CategoryCode, DEFAULT_ANCESTOR } from './ancestors.js'
import type { SourceId } from './sources.js'

export type ModuleStatus = 'PRODUCTION' | 'TESTNET' | 'EXPERIMENTAL' | 'RESEARCH' | 'COMING SOON'

export const MODULE_STATUSES: { status: ModuleStatus; meaning: string }[] = [
  { status: 'PRODUCTION', meaning: 'Implemented, checked by an outside security team and running on a mainnet descendant.' },
  { status: 'TESTNET', meaning: 'Implemented and running on a public test network. Not for real value.' },
  { status: 'EXPERIMENTAL', meaning: 'Prototype code exists and runs. Expect breaking changes.' },
  { status: 'RESEARCH', meaning: 'Specified as a design. No Quantum Fork implementation exists yet.' },
  { status: 'COMING SOON', meaning: 'Planned. Not yet specified in enough detail to evaluate.' },
]

export type Complexity = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY HIGH'

export type PqModuleId = 'cag' | 'hsp' | 'pqk' | 'pqr' | 'vid' | 'wcl' | 'spq' | 'lsp' | 'bmp' | 'pqt'

export interface PqModule {
  id: PqModuleId
  code: string
  name: string
  summary: string
  status: ModuleStatus
  implementation: string
  primitive: string
  standard: string
  compatibility: string
  performance: string
  sizeImpact: string | null
  complexity: Complexity
  dependencies: PqModuleId[]
  audit: 'UNAUDITED'
  /** Upstream code the design would build on. None of it is Quantum Fork code. */
  repositories: SourceId[]
  documentation: SourceId[]
  /** Provisional QFORK burn when the module is part of a genesis or fork. */
  burn: number
  addresses: CategoryCode[]
  part: OrganPart
  color: string
  warning?: string
}

const NO_IMPLEMENTATION = 'Design specification only. No Quantum Fork implementation exists.'

export const PQ_MODULES: PqModule[] = [
  {
    id: 'cag',
    code: 'PQ-00',
    name: 'CRYPTO-AGILITY LAYER',
    summary: 'Suite identifiers inside every signed payload, with deterministic activation and deprecation heights.',
    status: 'RESEARCH',
    implementation: NO_IMPLEMENTATION,
    primitive: 'Protocol mechanism (no new primitive)',
    standard: 'Transition guidance: NIST IR 8547 (draft)',
    compatibility: 'Prerequisite for every other module. New transaction version.',
    performance: 'Negligible: one suite tag per signature',
    sizeImpact: '+1 byte per signature (suite tag)',
    complexity: 'HIGH',
    dependencies: [],
    audit: 'UNAUDITED',
    repositories: [],
    documentation: ['nist-ir-8547', 'nist-pqc'],
    burn: 20_000,
    addresses: ['SIG', 'TXA'],
    part: 'hash',
    color: PALETTE.green,
  },
  {
    id: 'hsp',
    code: 'PQ-01',
    name: 'HYBRID SIGNATURE PROFILE',
    summary: 'Every signer provides secp256k1 ECDSA and ML-DSA-65. A transaction is valid only when both verify.',
    status: 'RESEARCH',
    implementation: NO_IMPLEMENTATION,
    primitive: 'secp256k1 ECDSA + ML-DSA-65',
    standard: 'SEC 2 + FIPS 204',
    compatibility: 'Breaking. Requires a new transaction type and wallet support.',
    performance: 'ML-DSA verification is fast; calldata and storage dominate the cost',
    sizeImpact: 'Signature 65 → 3,374 B, public key 33 → 1,985 B per signer',
    complexity: 'VERY HIGH',
    dependencies: ['cag', 'pqk'],
    audit: 'UNAUDITED',
    repositories: ['rustcrypto-signatures', 'liboqs', 'pqclean'],
    documentation: ['fips-204', 'rfc-8032'],
    burn: 60_000,
    addresses: ['SIG', 'TXA'],
    part: 'signature',
    color: PALETTE.yellow,
  },
  {
    id: 'pqk',
    code: 'PQ-02',
    name: 'PQ KEY ARCHITECTURE',
    summary: 'Addresses commit to a hash of the suite and key set, so keys can rotate without changing the address.',
    status: 'RESEARCH',
    implementation: NO_IMPLEMENTATION,
    primitive: 'Keccak-256 commitment to a key-set descriptor',
    standard: 'FIPS 202 hash commitments',
    compatibility: 'Breaking. New account type; balances migrate.',
    performance: 'Negligible',
    sizeImpact: 'Address stays 20 B; keys are revealed on first spend',
    complexity: 'VERY HIGH',
    dependencies: ['cag'],
    audit: 'UNAUDITED',
    repositories: [],
    documentation: ['eth-accounts', 'base-8130'],
    burn: 40_000,
    addresses: ['KEY'],
    part: 'keys',
    color: PALETTE.lime,
  },
  {
    id: 'pqr',
    code: 'PQ-03',
    name: 'PQ RECOVERY',
    summary: 'Owners commit to a hash-based SLH-DSA recovery key in advance and reveal it only to recover or migrate.',
    status: 'RESEARCH',
    implementation: NO_IMPLEMENTATION,
    primitive: 'SLH-DSA-SHA2-128s (hash-based)',
    standard: 'FIPS 205',
    compatibility: 'Opt-in per account. Requires PQ key architecture.',
    performance: 'Slow signing; only used during recovery',
    sizeImpact: 'Recovery signature 7,856 B (used rarely)',
    complexity: 'HIGH',
    dependencies: ['pqk'],
    audit: 'UNAUDITED',
    repositories: ['rustcrypto-signatures', 'liboqs'],
    documentation: ['fips-205', 'eth-quantum-emergency'],
    burn: 25_000,
    addresses: ['RCV'],
    part: 'recovery',
    color: PALETTE.steel,
  },
  {
    id: 'vid',
    code: 'PQ-04',
    name: 'PQ SEQUENCER IDENTITY',
    summary: 'The sequencer signs every block with ML-DSA alongside its secp256k1 key, and nodes check both before accepting it.',
    status: 'RESEARCH',
    implementation: NO_IMPLEMENTATION,
    primitive: 'secp256k1 + ML-DSA-65 block signing',
    standard: 'FIPS 204',
    compatibility: 'Node-breaking. Every node upgrades together.',
    performance: 'Larger gossiped blocks; verification stays cheap',
    sizeImpact: '+3,309 B per signed block',
    complexity: 'VERY HIGH',
    dependencies: ['cag'],
    audit: 'UNAUDITED',
    repositories: [],
    documentation: ['base-p2p', 'fips-204'],
    burn: 50_000,
    addresses: ['VAL'],
    part: 'consensus',
    color: PALETTE.green,
    warning: 'Settlement still rests on Ethereum’s BLS12-381 validator signatures until Ethereum migrates.',
  },
  {
    id: 'wcl',
    code: 'PQ-05',
    name: 'WALLET COMPATIBILITY LAYER',
    summary: 'An EIP-1193 provider method for suite-tagged signing, with a bounded classical fallback window.',
    status: 'COMING SOON',
    implementation: 'Not yet specified.',
    primitive: 'EIP-1193 provider extension',
    standard: 'EIP-1193 (extension, not standardized)',
    compatibility: 'Requires wallet vendors to adopt it.',
    performance: 'Wallet-side only',
    sizeImpact: null,
    complexity: 'HIGH',
    dependencies: ['hsp'],
    audit: 'UNAUDITED',
    repositories: [],
    documentation: ['eip-6963', 'coinbase-smart-wallet'],
    burn: 15_000,
    addresses: ['WLT'],
    part: 'keys',
    color: PALETTE.cyan,
  },
  {
    id: 'spq',
    code: 'PQ-06',
    name: 'SHIELDED + PQ PROFILE',
    summary: 'Confidential transfers with hash-based proofs and ML-KEM note encryption instead of pairing-based BN254 proofs.',
    status: 'RESEARCH',
    implementation: NO_IMPLEMENTATION,
    primitive: 'ML-KEM-768 encryption; hash-based proofs',
    standard: 'FIPS 203 (encryption). Proof systems are not standardized.',
    compatibility: 'Replaces pairing-based privacy proofs entirely.',
    performance: 'Larger proofs and slower verification than today',
    sizeImpact: 'Proofs grow from hundreds of bytes to tens of kilobytes',
    complexity: 'VERY HIGH',
    dependencies: ['cag'],
    audit: 'UNAUDITED',
    repositories: ['liboqs'],
    documentation: ['fips-203', 'sp1-verification'],
    burn: 45_000,
    addresses: ['PRF'],
    part: 'proof',
    color: PALETTE.purple,
    warning: 'Balances encrypted before migration are not protected retroactively.',
  },
  {
    id: 'lsp',
    code: 'PQ-07',
    name: 'LATTICE SIGNATURE PROFILE',
    summary: 'ML-DSA-65 only. Classical signatures are removed entirely.',
    status: 'RESEARCH',
    implementation: NO_IMPLEMENTATION,
    primitive: 'ML-DSA-65 (FN-DSA-512 once FIPS 206 is final)',
    standard: 'FIPS 204',
    compatibility: 'Breaks every classical wallet and tool.',
    performance: 'As hybrid, without the ECDSA overhead',
    sizeImpact: 'Signature 65 → 3,309 B, public key 33 → 1,952 B',
    complexity: 'VERY HIGH',
    dependencies: ['cag', 'pqk'],
    audit: 'UNAUDITED',
    repositories: ['rustcrypto-signatures', 'pqclean'],
    documentation: ['fips-204', 'fips-206'],
    burn: 70_000,
    addresses: ['SIG', 'TXA'],
    part: 'pq',
    color: PALETTE.red,
    warning: 'No classical fallback. A flaw in the lattice scheme or its implementation is not covered by a second signature.',
  },
  {
    id: 'bmp',
    code: 'PQ-08',
    name: 'BRIDGE MIGRATION PROFILE',
    summary: 'The descendant accepts only bridges that attest with post-quantum signatures on both sides.',
    status: 'COMING SOON',
    implementation: 'Not yet specified.',
    primitive: 'ML-DSA attestations',
    standard: 'FIPS 204',
    compatibility: 'Excludes every classical-only bridge.',
    performance: 'Larger attestations',
    sizeImpact: null,
    complexity: 'HIGH',
    dependencies: ['hsp'],
    audit: 'UNAUDITED',
    repositories: [],
    documentation: ['base-security-council', 'fips-204'],
    burn: 30_000,
    addresses: ['BRG'],
    part: 'modules',
    color: PALETTE.cyan,
  },
  {
    id: 'pqt',
    code: 'PQ-09',
    name: 'PQ TRANSPORT',
    summary: 'Hybrid X25519 + ML-KEM-768 key exchange for node P2P and RPC TLS.',
    status: 'RESEARCH',
    implementation: 'No Quantum Fork integration. Supported upstream in maintained TLS libraries.',
    primitive: 'X25519MLKEM768',
    standard: 'FIPS 203 + IETF hybrid TLS draft',
    compatibility: 'Negotiated per connection; falls back to classical peers.',
    performance: '+2.3 KB per handshake',
    sizeImpact: 'Key share 32 → 1,216 B',
    complexity: 'MEDIUM',
    dependencies: [],
    audit: 'UNAUDITED',
    repositories: ['rustls'],
    documentation: ['fips-203', 'tls-mlkem'],
    burn: 10_000,
    addresses: ['EXT'],
    part: 'privacy',
    color: PALETTE.cyan,
  },
]

export const MODULE_BY_ID = Object.fromEntries(PQ_MODULES.map((module) => [module.id, module])) as Record<PqModuleId, PqModule>
export const PQ_MODULE_IDS = PQ_MODULES.map((module) => module.id)

type ModuleText = Partial<Pick<PqModule, 'name' | 'summary' | 'primitive' | 'standard' | 'compatibility' | 'performance' | 'sizeImpact' | 'repositories' | 'documentation' | 'warning'>>

/** The catalogue above is written for Base. A Solana descendant replaces ECDSA with Ed25519 and the sequencer with validators. */
const SOLANA_TEXT: Partial<Record<PqModuleId, ModuleText>> = {
  hsp: {
    summary: 'Every signer provides Ed25519 and ML-DSA-65. A transaction is valid only when both verify.',
    primitive: 'Ed25519 + ML-DSA-65',
    standard: 'RFC 8032 + FIPS 204',
    compatibility: 'Breaking. Requires larger transactions and wallet support.',
    performance: 'ML-DSA verification is fast; bandwidth and storage dominate the cost',
    sizeImpact: 'Signature 64 → 3,373 B, public key 32 → 1,984 B per signer',
  },
  pqk: {
    primitive: 'SHA-256 commitment to a key-set descriptor',
    standard: 'FIPS 180-4 / FIPS 202 hash commitments',
    compatibility: 'Breaking. New address format; balances migrate.',
    sizeImpact: 'Address stays 32 B; keys are revealed on first spend',
    documentation: ['solana-accounts', 'anagram-pq'],
  },
  pqr: { documentation: ['fips-205', 'blueshift-pq'] },
  vid: {
    name: 'PQ VALIDATOR IDENTITY',
    summary: 'Hybrid validator identity keys with per-validator ML-DSA attestations alongside classical vote certificates.',
    primitive: 'Ed25519 + ML-DSA-65 identity; BLS12-381 certificates retained',
    compatibility: 'Consensus-breaking. Every validator upgrades together.',
    performance: 'Significant gossip and vote bandwidth increase',
    sizeImpact: '+3,309 B per validator attestation',
    repositories: ['agave', 'firedancer'],
    documentation: ['simd-0326', 'anagram-pq'],
    warning: 'Post-quantum signatures do not aggregate like BLS. Certificate size is an open problem.',
  },
  wcl: {
    summary: 'A Wallet Standard feature for suite-tagged signing, with a bounded classical fallback window.',
    primitive: 'Wallet Standard feature extension',
    standard: 'Wallet Standard (extension, not standardized)',
    repositories: ['wallet-standard'],
    documentation: ['wallet-standard'],
  },
  spq: {
    summary: 'Confidential transfers with hash-based proofs and ML-KEM note encryption instead of Curve25519 ElGamal.',
    compatibility: 'Replaces the confidential-transfer extension entirely.',
    documentation: ['fips-203', 'token-2022-status'],
  },
  lsp: { performance: 'As hybrid, without the Ed25519 overhead', sizeImpact: 'Signature 64 → 3,309 B, public key 32 → 1,952 B' },
  bmp: { repositories: ['wormhole'], documentation: ['fips-204'] },
  pqt: { summary: 'Hybrid X25519 + ML-KEM-768 key exchange for validator QUIC and RPC TLS.' },
}

const ANCESTOR_TEXT: Record<AncestorId, Partial<Record<PqModuleId, ModuleText>>> = { base: {}, solana: SOLANA_TEXT }

/** A module as it applies to one ancestor's descendants. */
export function moduleFor(id: PqModuleId, ancestor: AncestorId = DEFAULT_ANCESTOR): PqModule {
  return { ...MODULE_BY_ID[id], ...ANCESTOR_TEXT[ancestor][id] }
}

/** Adds every transitive dependency, preserving catalogue order. */
export function withDependencies(ids: readonly PqModuleId[]): PqModuleId[] {
  const selected = new Set<PqModuleId>()
  const visit = (id: PqModuleId) => {
    if (selected.has(id)) return
    selected.add(id)
    MODULE_BY_ID[id].dependencies.forEach(visit)
  }
  ids.forEach(visit)
  return PQ_MODULE_IDS.filter((id) => selected.has(id))
}

export function missingDependencies(ids: readonly PqModuleId[]): PqModuleId[] {
  const set = new Set(ids)
  return withDependencies(ids).filter((id) => !set.has(id))
}

/** Modules that require `id`, among the selection. */
export function dependents(id: PqModuleId, ids: readonly PqModuleId[]): PqModuleId[] {
  return ids.filter((other) => other !== id && withDependencies([other]).includes(id))
}

export function moduleCounts() {
  const counts = Object.fromEntries(MODULE_STATUSES.map(({ status }) => [status, 0])) as Record<ModuleStatus, number>
  for (const module of PQ_MODULES) counts[module.status] += 1
  return counts
}

const STATUS_ORDER: ModuleStatus[] = ['COMING SOON', 'RESEARCH', 'EXPERIMENTAL', 'TESTNET', 'PRODUCTION']

/** The least mature status among a configuration's modules. */
export function profileStatus(config: { modules: readonly PqModuleId[] }): ModuleStatus | null {
  if (!config.modules.length) return null
  return config.modules.map((id) => MODULE_BY_ID[id].status).sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b))[0]
}
