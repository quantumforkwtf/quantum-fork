import { z } from 'zod'
import { type ChainGenome, GENOME_SPEC } from '../lab/genome.js'
import { ANCESTOR_IDS, ANCESTOR_NAME, type AncestorId, type CategoryCode, DEFAULT_ANCESTOR, MODELS } from './ancestors.js'
import { moduleFor, PQ_MODULE_IDS, type PqModuleId, withDependencies } from './modules.js'
import { PROFILE_BY_ID, type ProfileId } from './profiles.js'

export type DeploymentTier = 'testnet' | 'mainnet'

export const TIERS: { id: DeploymentTier; label: string; detail: string }[] = [
  { id: 'testnet', label: 'TESTNET', detail: 'Burn test QFORK. The server verifies the burn on-chain and registers the descendant. Test tokens have no value.' },
  { id: 'mainnet', label: 'MAINNET', detail: 'Burn real $QFORK. The server verifies the burn on-chain and registers the descendant.' },
]

const NAME = /^[A-Z0-9][A-Z0-9 -]{1,22}[A-Z0-9]$/
const SYMBOL = /^[A-Z0-9]{2,6}$/
const NETWORK_ID = /^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$/

export const descendantSchema = z
  .object({
    ancestor: z.enum(ANCESTOR_IDS),
    profile: z.enum(['hybrid', 'pq-forward', 'research', 'custom']),
    modules: z.array(z.enum(PQ_MODULE_IDS as [PqModuleId, ...PqModuleId[]])).max(PQ_MODULE_IDS.length),
    network: z.object({
      name: z.string().regex(NAME, 'Use 3–24 characters: A–Z, 0–9, spaces or dashes.'),
      symbol: z.string().regex(SYMBOL, 'Use 2–6 characters: A–Z or 0–9.'),
      networkId: z.string().regex(NETWORK_ID, 'Use 4–32 characters: a–z, 0–9 or dashes.'),
    }),
    validators: z.object({
      count: z.number().int().min(4).max(128),
      hardware: z.enum(['standard', 'high']),
    }),
    rpc: z.object({ access: z.enum(['public', 'private']) }),
    economics: z.object({
      baseFeeLamports: z.number().int().min(0).max(1_000_000),
      burnPct: z.number().int().min(0).max(100),
    }),
    privacy: z.enum(['public', 'shielded']),
    recovery: z.enum(['none', 'pq-commitment']),
    tier: z.enum(['testnet', 'mainnet']),
  })
  .strict()

export type DescendantConfig = z.infer<typeof descendantSchema>

const DEFAULT_NETWORK: Record<AncestorId, DescendantConfig['network']> = {
  base: { name: 'BASE HYBRID', symbol: 'QBASE', networkId: 'qf-base-hybrid' },
  solana: { name: 'SOLANA HYBRID', symbol: 'QSOL', networkId: 'qf-solana-hybrid' },
}

export function defaultConfig(profile: ProfileId = 'hybrid', ancestor: AncestorId = DEFAULT_ANCESTOR): DescendantConfig {
  return normalizeConfig({
    ancestor,
    profile,
    modules: PROFILE_BY_ID[profile].modules,
    network: DEFAULT_NETWORK[ancestor],
    validators: { count: 32, hardware: 'standard' },
    rpc: { access: 'public' },
    economics: { baseFeeLamports: 5_000, burnPct: 50 },
    privacy: 'public',
    recovery: 'pq-commitment',
    tier: 'testnet',
  })
}

/** Resolves dependencies and keeps privacy/recovery consistent with the chosen modules. */
export function normalizeConfig(config: DescendantConfig): DescendantConfig {
  const requested = new Set(config.profile === 'custom' ? config.modules : PROFILE_BY_ID[config.profile].modules)
  if (config.recovery === 'pq-commitment') requested.add('pqr')
  if (config.privacy === 'shielded' && config.profile === 'research') requested.add('spq')
  const modules = withDependencies([...requested])
  return {
    ...config,
    modules,
    recovery: modules.includes('pqr') ? 'pq-commitment' : 'none',
  }
}

export function applyProfile(config: DescendantConfig, profile: ProfileId): DescendantConfig {
  return normalizeConfig({ ...config, profile, modules: PROFILE_BY_ID[profile].modules })
}

/** Visual genome for the 3D organism. Not used for any security decision. */
export function toChainGenome(config: DescendantConfig, generation = 1, parent: string | null = config.ancestor): ChainGenome {
  const profile = PROFILE_BY_ID[config.profile]
  const morphology = config.modules.includes('lsp') ? 'experimental' : profile.morphology
  const evm = config.ancestor === 'base'
  return {
    spec: GENOME_SPEC,
    identity: { name: config.network.name, ticker: config.network.symbol, supply: 1_000_000_000 },
    execution: {
      vm: evm ? 'evm' : 'svm',
      blockTimeMs: config.validators.hardware === 'high' ? (evm ? 1000 : 400) : evm ? 2000 : 1000,
      validators: config.validators.count,
      modules: config.modules.includes('bmp') ? ['bridge', 'oracle'] : ['bridge'],
    },
    privacy: config.privacy === 'shielded' || config.modules.includes('spq') ? 'shielded' : 'public',
    cryptography: { profile: morphology },
    economics: { gas: 'dynamic', baseFeeMicros: Math.round(config.economics.baseFeeLamports / 100), treasuryPct: 0, burnPct: config.economics.burnPct },
    recovery: config.modules.includes('pqr') ? 'threshold' : 'none',
    lineage: { family: ANCESTOR_NAME[config.ancestor], generation, parent, mutations: [] },
  }
}

const ANCESTOR_GENOME: Record<AncestorId, ChainGenome> = {
  base: {
    spec: GENOME_SPEC,
    identity: { name: 'BASE', ticker: 'ETH', supply: 1_000_000_000 },
    execution: { vm: 'evm', blockTimeMs: 2000, validators: 1, modules: ['bridge', 'oracle'] },
    privacy: 'public',
    cryptography: { profile: 'classical' },
    economics: { gas: 'dynamic', baseFeeMicros: 1, treasuryPct: 0, burnPct: 0 },
    recovery: 'none',
    lineage: { family: 'BASE', generation: 0, parent: null, mutations: [] },
  },
  solana: {
    spec: GENOME_SPEC,
    identity: { name: 'SOLANA', ticker: 'SOL', supply: 1_000_000_000 },
    execution: { vm: 'svm', blockTimeMs: 400, validators: 128, modules: ['bridge'] },
    privacy: 'shielded',
    cryptography: { profile: 'classical' },
    economics: { gas: 'dynamic', baseFeeMicros: 50, treasuryPct: 0, burnPct: 50 },
    recovery: 'none',
    lineage: { family: 'SOLANA', generation: 0, parent: null, mutations: [] },
  },
}

/** The ancestor itself as a visual genome (generation 0). */
export function ancestorGenome(ancestor: AncestorId = DEFAULT_ANCESTOR): ChainGenome {
  return ANCESTOR_GENOME[ancestor]
}

export const baseGenome = () => ancestorGenome('base')
export const solanaGenome = () => ancestorGenome('solana')

export interface DiffRow {
  code: CategoryCode
  name: string
  ancestor: string
  descendant: string
  changed: boolean
  modules: PqModuleId[]
}

const ANCESTOR_SUMMARY: Record<AncestorId, Record<CategoryCode, string>> = {
  base: {
    SIG: 'secp256k1 ECDSA · P-256 passkeys',
    KEY: 'Address = keccak256(public key), no EOA rotation',
    HSH: 'Keccak-256 · SHA-256',
    TXA: 'ECDSA sender recovery',
    VAL: 'secp256k1 sequencer key · Ethereum BLS12-381',
    WLT: 'BIP-32 secp256k1 wallets',
    BRG: 'secp256k1 upgrade multisigs',
    RCV: 'No protocol-level recovery for EOAs',
    PRF: 'TEE + SP1 over BN254 · KZG blobs',
    EXT: 'X25519 TLS key exchange',
  },
  solana: {
    SIG: 'Ed25519',
    KEY: 'Address = Ed25519 public key, no rotation',
    HSH: 'SHA-256 · Blake3 · Keccak-256',
    TXA: 'Ed25519 sigverify · 1,232-byte limit',
    VAL: 'Ed25519 identity · BLS12-381 votes',
    WLT: 'SLIP-0010 Ed25519 wallets',
    BRG: 'Classical bridge attestations',
    RCV: 'No protocol-level recovery',
    PRF: 'Curve25519 ElGamal proofs',
    EXT: 'X25519 TLS key exchange',
  },
}

export function genomeDiff(config: DescendantConfig): DiffRow[] {
  const summary = ANCESTOR_SUMMARY[config.ancestor]
  return MODELS[config.ancestor].loci.map((locus) => {
    const modules = config.modules.filter((id) => moduleFor(id, config.ancestor).addresses.includes(locus.code))
    const ancestor = summary[locus.code]
    let descendant = ancestor
    if (modules.length) descendant = modules.map((id) => moduleFor(id, config.ancestor).primitive).join(' + ')
    if (config.ancestor === 'solana' && locus.code === 'PRF' && config.privacy === 'public' && !modules.length) descendant = 'Confidential transfers disabled'
    return { code: locus.code, name: locus.name, ancestor, descendant, changed: descendant !== ancestor, modules }
  })
}

/** The ancestor itself, expressed as diff rows with nothing changed. */
export function ancestorRows(ancestor: AncestorId = DEFAULT_ANCESTOR): DiffRow[] {
  const summary = ANCESTOR_SUMMARY[ancestor]
  return MODELS[ancestor].loci.map((locus) => ({ code: locus.code, name: locus.name, ancestor: summary[locus.code], descendant: summary[locus.code], changed: false, modules: [] }))
}

/** Unchanged classical dependencies that remain after migration. */
export function remainingExposure(config: DescendantConfig) {
  return genomeDiff(config).filter((row) => !row.changed && row.code !== 'HSH')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** SHA-256 over the canonical JSON of the configuration, excluding the deployment tier. */
export async function genomeHash(config: DescendantConfig): Promise<string> {
  const { tier: _tier, ...rest } = config
  void _tier
  const bytes = new TextEncoder().encode(`qfork/descendant/v1:${canonical(rest)}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
