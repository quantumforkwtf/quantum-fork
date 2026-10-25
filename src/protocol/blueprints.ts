import { ANCESTORS, type AncestorId } from './ancestors.js'
import type { PqModuleId } from './modules.js'
import type { ProfileId } from './profiles.js'

/**
 * Blueprints describe what someone wants to build. They hold no cryptographic
 * logic of their own: the compiler turns a blueprint plus Simple Mode answers
 * into a descendant configuration (network blueprints) or an application
 * genome (application blueprints), using the existing modules and profiles.
 */

export type BlueprintStatus = 'AVAILABLE' | 'TESTNET' | 'EXPERIMENTAL' | 'RESEARCH' | 'COMING SOON'

export const BLUEPRINT_STATUSES: { status: BlueprintStatus; meaning: string }[] = [
  { status: 'AVAILABLE', meaning: 'Everything this blueprint produces works in this build.' },
  { status: 'TESTNET', meaning: 'Runs only on a public test network, with test tokens. Not for real value.' },
  { status: 'EXPERIMENTAL', meaning: 'Prototype code exists and runs. Expect breaking changes.' },
  { status: 'RESEARCH', meaning: 'The architecture can be configured and registered here. Its post-quantum components are designs; no Quantum Fork implementation exists.' },
  { status: 'COMING SOON', meaning: 'Depends on something that is not built yet. You can explore the design, but not build it.' },
]

/** Higher is more mature. A blueprint is only as mature as its least mature required part. */
export const STATUS_RANK: Record<BlueprintStatus, number> = { AVAILABLE: 4, TESTNET: 3, EXPERIMENTAL: 2, RESEARCH: 1, 'COMING SOON': 0 }

export type BlueprintCategory = 'NETWORK' | 'APPLICATION' | 'EXPERT'
export type VisualType = 'descendant' | 'vault' | 'payments' | 'membrane' | 'agents' | 'enterprise' | 'app-scan' | 'chain-scan' | 'helix'
export type ToneId = 'lime' | 'cyan' | 'yellow' | 'purple' | 'green' | 'steel' | 'orange' | 'red'
export type BurnOperation = 'GENESIS' | 'MUTATION' | 'FORK' | 'APPLICATION_MODULE' | 'NONE'
/** Where the blueprint's primary action leads. The compiler decides whether it may be offered. */
export type BlueprintRoute = 'lab' | 'studio' | 'scanner' | 'expert'

/* ---------- platform capabilities and application components ---------- */

export type PlatformId = 'lab' | 'scanner' | 'infrastructure'

export const PLATFORM: Record<PlatformId, { name: string; status: BlueprintStatus; detail: string }> = {
  lab: { name: 'Genome configuration', status: 'AVAILABLE', detail: 'Configure, validate and diff a genome in the lab.' },
  scanner: { name: 'Exposure scanner', status: 'AVAILABLE', detail: 'A hand-built map of Base’s and Solana’s cryptographic dependencies, with sources.' },
  infrastructure: { name: 'Network infrastructure', status: 'COMING SOON', detail: 'Real validators, RPC and explorer are not built. No chain runs a descendant yet.' },
}

export type ComponentId =
  | 'hybrid-auth'
  | 'pq-keyset'
  | 'threshold-auth'
  | 'org-policy'
  | 'pq-recovery'
  | 'guardian-recovery'
  | 'signer-transport'
  | 'agent-wallets'
  | 'spending-policy'
  | 'permissioning'
  | 'surface-map'
  | 'repo-scan'
  | 'tls-upgrade'
  | 'token-signing'
  | 'data-keys'
  | 'wallet-bound'

export interface AppComponent {
  id: ComponentId
  code: string
  name: string
  summary: string
  primitive: string
  status: BlueprintStatus
  implementation: string
  /** A change the blueprint recommends and reports on, made in your own stack. It does not limit the blueprint's status. */
  advisory?: true
}

const DESIGN_ONLY = 'Design only. No Quantum Fork implementation exists.'
const GUIDANCE = 'Guidance only. The change is made in your own stack with upstream libraries.'

export const COMPONENTS: AppComponent[] = [
  { id: 'hybrid-auth', code: 'AC-01', name: 'HYBRID AUTHORIZATION', summary: 'A withdrawal needs the owner’s Base signature and a separate post-quantum authorization checked by the vault.', primitive: 'secp256k1 ECDSA (Base) + ML-DSA-65 (vault policy)', status: 'RESEARCH', implementation: DESIGN_ONLY },
  { id: 'pq-keyset', code: 'AC-02', name: 'PQ KEY ARCHITECTURE', summary: 'The vault commits to a hash of its authorized key set, so keys can rotate without moving the assets.', primitive: 'Keccak-256 commitment to a key-set descriptor', status: 'RESEARCH', implementation: DESIGN_ONLY },
  { id: 'threshold-auth', code: 'AC-03', name: 'THRESHOLD AUTHORIZATION', summary: 'Several owners each hold a key; a set number of them must approve.', primitive: 'm-of-n hybrid approvals', status: 'RESEARCH', implementation: DESIGN_ONLY },
  { id: 'org-policy', code: 'AC-04', name: 'ORGANIZATION POLICY', summary: 'Roles, limits and approval rules defined by an organization.', primitive: 'Policy engine (not specified)', status: 'COMING SOON', implementation: 'Not yet specified.' },
  { id: 'pq-recovery', code: 'AC-05', name: 'PQ RECOVERY KEY', summary: 'A hash-based recovery key is committed in advance and revealed only to recover.', primitive: 'SLH-DSA-SHA2-128s', status: 'RESEARCH', implementation: DESIGN_ONLY },
  { id: 'guardian-recovery', code: 'AC-06', name: 'RECOVERY GUARDIANS', summary: 'Named guardians approve a recovery together, each with a post-quantum key.', primitive: 'm-of-n SLH-DSA guardian approvals', status: 'RESEARCH', implementation: DESIGN_ONLY },
  { id: 'signer-transport', code: 'AC-07', name: 'PQ SIGNER TRANSPORT', summary: 'Hybrid post-quantum key exchange between owners and any off-chain signing service.', primitive: 'X25519MLKEM768', status: 'RESEARCH', implementation: GUIDANCE },
  { id: 'agent-wallets', code: 'AC-08', name: 'AGENT WALLETS', summary: 'Accounts owned by autonomous agents, bounded by their owner.', primitive: 'Hybrid account keys with delegated scopes', status: 'COMING SOON', implementation: 'Not yet specified.' },
  { id: 'spending-policy', code: 'AC-09', name: 'SPENDING POLICIES', summary: 'Programmable limits on what an agent may spend, where and how often.', primitive: 'Policy engine (not specified)', status: 'COMING SOON', implementation: 'Not yet specified.' },
  { id: 'permissioning', code: 'AC-10', name: 'VALIDATOR PERMISSIONING', summary: 'Only approved operators may join the validator set.', primitive: 'Allow-listed validator identities', status: 'COMING SOON', implementation: 'Not yet specified. The genome records it without enforcing it.' },
  { id: 'surface-map', code: 'AC-11', name: 'SURFACE MAP', summary: 'A checklist that maps where your application depends on classical public-key cryptography.', primitive: 'Self-reported checklist', status: 'AVAILABLE', implementation: 'Runs in your browser from your answers. Nothing is uploaded.' },
  { id: 'repo-scan', code: 'AC-12', name: 'REPOSITORY SCAN', summary: 'Finds RSA, elliptic-curve and Diffie-Hellman usage, signed tokens, TLS and SSH configuration, committed keys and crypto dependencies in your code.', primitive: 'Static pattern scan', status: 'AVAILABLE', implementation: 'Public GitHub repositories are scanned on the server and discarded; local folders and pasted code are scanned in your browser. It matches patterns in the source text.' },
  { id: 'tls-upgrade', code: 'AC-13', name: 'HYBRID TLS', summary: 'Negotiate hybrid post-quantum key exchange on every TLS connection.', primitive: 'X25519MLKEM768', status: 'RESEARCH', implementation: `${GUIDANCE} Recent releases of major TLS libraries support it.`, advisory: true },
  { id: 'token-signing', code: 'AC-14', name: 'PQ TOKEN SIGNING', summary: 'Sign session and API tokens with a post-quantum signature.', primitive: 'ML-DSA-65', status: 'RESEARCH', implementation: `${GUIDANCE} JOSE and COSE support for ML-DSA is still being standardized.`, advisory: true },
  { id: 'data-keys', code: 'AC-15', name: 'PQ DATA KEYS', summary: 'Wrap long-lived data keys with a post-quantum KEM, so recorded data cannot be decrypted later.', primitive: 'ML-KEM-768 key encapsulation', status: 'RESEARCH', implementation: GUIDANCE, advisory: true },
  { id: 'wallet-bound', code: 'AC-16', name: 'CHAIN-BOUND SIGNATURES', summary: 'Wallet signatures are fixed by the chain they belong to. An app cannot upgrade them alone.', primitive: 'secp256k1 / Ed25519 (set by the chain)', status: 'COMING SOON', implementation: 'Needs a post-quantum chain. See Quantumize My Chain.', advisory: true },
]

export const COMPONENT_BY_ID = Object.fromEntries(COMPONENTS.map((item) => [item.id, item])) as Record<ComponentId, AppComponent>

export type CapabilityRef = `platform:${PlatformId}` | `module:${PqModuleId}` | `component:${ComponentId}`

/* ---------- genome ---------- */

export type Authorization = 'network-accounts' | 'single-owner' | 'multi-owner' | 'organization' | 'agent-policy'
export type Recovery = 'none' | 'pq-commitment' | 'guardians' | 'custom'
export type Privacy = 'public' | 'shielded' | 'shielded-pq' | 'not-applicable'
export type Consensus = 'inherited' | 'pq-validator-identity' | 'not-applicable'
export type NetworkType = 'independent' | 'private' | 'permissioned' | 'on-base' | 'existing-app' | 'existing-chain'
export type InfrastructureTier = 'registered' | 'none'

export interface NetworkShape {
  name: string
  symbol: string
  networkId: string
  validators: number
  hardware: 'standard' | 'high'
  rpc: 'public' | 'private'
  baseFeeLamports: number
  burnPct: number
}

export interface BlueprintGenome {
  /** Network blueprints only. Application blueprints never pick a chain profile. */
  pqProfile: ProfileId | null
  security: 'recommended' | 'advanced' | 'experimental'
  authorization: Authorization
  keyArchitecture: 'pq-commitment' | 'classical'
  recovery: Recovery
  privacy: Privacy
  consensus: Consensus
  networkType: NetworkType
  infrastructureTier: InfrastructureTier
  components: ComponentId[]
  network: NetworkShape | null
  subject: string | null
}

export type GenomePatch = Partial<Omit<BlueprintGenome, 'network' | 'components'>> & {
  network?: Partial<NetworkShape>
  components?: ComponentId[]
}

export interface QuestionOption {
  id: string
  label: string
  detail: string
  patch: GenomePatch
  tag?: string
  disabled?: string
}

export interface BlueprintQuestion {
  id: string
  prompt: string
  options: QuestionOption[]
  defaultOption: string
  /** Asked only when another answer matches. */
  showIf?: { question: string; oneOf: string[] }
}

export interface CompatibilityRow {
  label: string
  verdict: 'UNCHANGED' | 'COMPATIBLE' | 'PARTIAL' | 'BREAKING' | 'UNSOLVED'
  detail: string
}

export interface Blueprint {
  id: string
  slug: string
  index: string
  name: string
  headline: string
  description: string
  category: BlueprintCategory
  visualType: VisualType
  tone: ToneId
  visualLabels: string[]
  ancestor: AncestorId | 'your-application' | 'scanned-chain'
  idealFor: string[]
  building: string
  configures: string[]
  securityModel: string[]
  remainsClassical: string[]
  infrastructure: string[]
  compatibility: CompatibilityRow[]
  limitations: string[]
  recommendedGenome: BlueprintGenome
  optionalModules: PqModuleId[]
  requiredCapabilities: CapabilityRef[]
  questions: BlueprintQuestion[]
  qforkBurnModel: BurnOperation
  route: BlueprintRoute
  cta: string
  featured: boolean
}

const network = (name: string, symbol: string, networkId: string, rest: Partial<NetworkShape> = {}): NetworkShape => ({
  name,
  symbol,
  networkId,
  validators: 32,
  hardware: 'standard',
  rpc: 'public',
  baseFeeLamports: 5_000,
  burnPct: 50,
  ...rest,
})

const NETWORK_BASE = {
  authorization: 'network-accounts',
  keyArchitecture: 'pq-commitment',
  recovery: 'pq-commitment',
  privacy: 'public',
  consensus: 'inherited',
  networkType: 'independent',
  infrastructureTier: 'registered',
  components: [],
  subject: null,
} as const satisfies Partial<BlueprintGenome>

const APPLICATION_BASE = {
  pqProfile: null,
  security: 'recommended',
  privacy: 'not-applicable',
  consensus: 'not-applicable',
  infrastructureTier: 'none',
  network: null,
} as const satisfies Partial<BlueprintGenome>

const SECURITY_QUESTION: BlueprintQuestion = {
  id: 'security',
  prompt: 'Security profile?',
  defaultOption: 'recommended',
  options: [
    { id: 'recommended', label: 'Recommended', detail: 'Classical and post-quantum signatures together. Today’s tools keep working through the migration.', patch: { pqProfile: 'hybrid', security: 'recommended', consensus: 'inherited' } },
    { id: 'advanced', label: 'Advanced', detail: 'Also upgrades sequencer identity and refuses classical-only bridges. Every node must upgrade together.', patch: { pqProfile: 'pq-forward', security: 'advanced', consensus: 'pq-validator-identity' } },
  ],
}

const NETWORK_REMAINS_CLASSICAL = [
  'Settlement on Ethereum stays classical: its validators sign with BLS12-381 until Ethereum migrates.',
  'Bridges that attest classically remain an exposure unless the bridge rules refuse them.',
  'Anything signed on Base itself. The descendant is a separate network; Base does not change.',
]

const REGISTERED_INFRA = [
  'No chain runs a descendant yet: sequencer, RPC and an explorer are not built.',
  'A QFORK burn, verified on-chain by the server, registers the design permanently with a receipt and a developer kit.',
  'Tokens for the descendant are real tokens on Base, launched through Clanker from the owner’s wallet.',
]

/** Rows that replace a blueprint's own when the compiled profile changes the answer. */
export const COMPATIBILITY_OVERRIDES: Partial<Record<ProfileId, CompatibilityRow[]>> = {
  research: [{ label: 'Wallets', verdict: 'BREAKING', detail: 'No classical signatures: incompatible with every existing EVM wallet.' }],
}

const NETWORK_COMPAT: CompatibilityRow[] = [
  { label: 'Base', verdict: 'UNCHANGED', detail: 'Base is the ancestor. Forking it does not change Base or anything on it.' },
  { label: 'Contracts', verdict: 'PARTIAL', detail: 'The execution layer is inherited (EVM). Contracts that call ecrecover or verify ECDSA signatures themselves need review.' },
  { label: 'Existing assets', verdict: 'BREAKING', detail: 'An independent network starts from its own genesis. Balances do not carry over automatically.' },
]

export const BLUEPRINTS: Blueprint[] = [
  {
    id: 'QF-BP-001',
    slug: 'quantum-chain',
    index: '01',
    name: 'Quantum Chain',
    headline: 'Launch your own post-quantum-oriented blockchain.',
    description: 'Create an independent network derived from Base’s architecture (OP Stack), with a post-quantum migration profile, a native asset, RPC infrastructure and an explorer.',
    category: 'NETWORK',
    visualType: 'descendant',
    tone: 'lime',
    visualLabels: ['BASE', 'HYBRID PQ DESCENDANT'],
    ancestor: 'base',
    idealFor: ['NEW L1s', 'APPCHAINS', 'FINANCIAL NETWORKS', 'EXPERIMENTAL CRYPTOGRAPHY'],
    building: 'A new blockchain that starts from Base’s design and replaces the parts of its cryptography that a quantum computer would break, as far as the chosen profile goes.',
    configures: ['Post-quantum profile and the modules it needs', 'Signature and key architecture', 'Account recovery', 'Node set size and hardware', 'Native asset symbol, fees and fee burn', 'RPC access'],
    securityModel: [
      'Recommended profile: every transaction carries a classical and a post-quantum signature, and both must verify. It stays secure if either scheme holds.',
      'Addresses commit to a hash of their keys, so keys can rotate without moving funds.',
      'A hash-based recovery key is committed in advance and only revealed to recover an account.',
    ],
    remainsClassical: NETWORK_REMAINS_CLASSICAL,
    infrastructure: REGISTERED_INFRA,
    compatibility: [...NETWORK_COMPAT, { label: 'Wallets', verdict: 'BREAKING', detail: 'Hybrid signing needs wallet support. The wallet compatibility layer is not specified yet.' }],
    limitations: ['No post-quantum execution client exists; every module is a design specification.', 'Larger signatures mean larger transactions and lower throughput.'],
    recommendedGenome: { ...NETWORK_BASE, pqProfile: 'hybrid', security: 'recommended', network: network('QUANTUM CHAIN', 'QCHN', 'qf-quantum-chain') },
    optionalModules: ['vid', 'bmp', 'spq'],
    requiredCapabilities: ['platform:lab', 'module:cag', 'module:hsp', 'module:pqk'],
    questions: [
      {
        id: 'coverage',
        prompt: 'How far should the cryptography go?',
        defaultOption: 'recommended',
        options: [
          { id: 'recommended', label: 'Recommended', detail: 'Classical and post-quantum signatures together. Today’s tools keep working through the migration.', patch: { pqProfile: 'hybrid', security: 'recommended', consensus: 'inherited' } },
          { id: 'broad', label: 'Broader coverage', detail: 'Also upgrades sequencer identity and refuses classical-only bridges. Every node upgrades together.', patch: { pqProfile: 'pq-forward', security: 'advanced', consensus: 'pq-validator-identity' } },
          { id: 'experimental', label: 'Fully post-quantum', detail: 'No classical fallback at all. For experiments, never for real assets.', tag: 'EXPERIMENTAL', patch: { pqProfile: 'research', security: 'experimental', consensus: 'pq-validator-identity' } },
        ],
      },
      {
        id: 'scale',
        prompt: 'How large is the network at genesis?',
        defaultOption: 'standard',
        options: [
          { id: 'small', label: 'Small', detail: '8 validators on standard hardware.', patch: { network: { validators: 8, hardware: 'standard' } } },
          { id: 'standard', label: 'Standard', detail: '32 validators on standard hardware.', patch: { network: { validators: 32, hardware: 'standard' } } },
          { id: 'performance', label: 'High performance', detail: '64 validators on high-performance hardware, with faster blocks.', patch: { network: { validators: 64, hardware: 'high' } } },
        ],
      },
      {
        id: 'access',
        prompt: 'Who can use the network’s RPC?',
        defaultOption: 'public',
        options: [
          { id: 'public', label: 'Anyone', detail: 'A public RPC endpoint.', patch: { network: { rpc: 'public' } } },
          { id: 'private', label: 'Only your apps', detail: 'A private, authenticated RPC endpoint.', patch: { network: { rpc: 'private' } } },
        ],
      },
    ],
    qforkBurnModel: 'GENESIS',
    route: 'lab',
    cta: 'Build Quantum Chain',
    featured: true,
  },
  {
    id: 'QF-BP-002',
    slug: 'quantum-vault',
    index: '02',
    name: 'Quantum Vault',
    headline: 'Protect digital assets with a post-quantum authorization layer.',
    description: 'Design a vault where moving assets needs a post-quantum authorization in addition to a normal Base signature. It is a contract on Base, not a new blockchain.',
    category: 'APPLICATION',
    visualType: 'vault',
    tone: 'cyan',
    visualLabels: ['CLASSICAL AUTH', 'PQ AUTH', 'RECOVERY'],
    ancestor: 'your-application',
    idealFor: ['DAO TREASURIES', 'PROTOCOL FUNDS', 'LONG-TERM CUSTODY', 'TOKENIZED ASSETS'],
    building: 'A vault contract that holds assets on Base and only releases them when both a classical signature and a post-quantum authorization approve.',
    configures: ['Who can authorize a withdrawal', 'Post-quantum key architecture for the vault’s owners', 'How the vault is recovered', 'Security profile'],
    securityModel: [
      'Every withdrawal needs the owner’s Base signature and a separate ML-DSA authorization checked by the vault. Breaking one of them is not enough to move assets out of the vault.',
      'Owner keys are committed by hash, so they can rotate without moving the assets.',
      'Recovery uses hash-based keys committed in advance.',
    ],
    remainsClassical: [
      'Base itself. Its transactions, sequencer and settlement stay classical. The vault does not make Base quantum-resistant.',
      'Anything outside the vault: wallets, token balances and contracts the vault does not control.',
      'The vault contract’s upgrade admin, unless it is also placed behind the vault’s authorization.',
    ],
    infrastructure: ['No vault contract exists in this build. You can configure the genome only.', 'Nothing is deployed and nothing can be burned for it.'],
    compatibility: [
      { label: 'Base', verdict: 'UNCHANGED', detail: 'The vault would be a contract on Base. Base does not change.' },
      { label: 'Wallets', verdict: 'PARTIAL', detail: 'The classical half works with any EVM wallet. No wallet produces the post-quantum half today.' },
      { label: 'Gas', verdict: 'UNSOLVED', detail: 'An ML-DSA-65 signature (3,309 B) fits in a Base transaction, but carrying it costs about 52,600 gas of calldata and verifying it in Solidity costs far more. No production verifier exists.' },
    ],
    limitations: ['No vault contract has been written.', 'Verifying ML-DSA in a Base contract at an acceptable gas cost is an open engineering problem.'],
    recommendedGenome: { ...APPLICATION_BASE, authorization: 'single-owner', keyArchitecture: 'pq-commitment', recovery: 'pq-commitment', networkType: 'on-base', components: ['hybrid-auth', 'pq-keyset'], subject: 'CRYPTO TREASURY' },
    optionalModules: [],
    requiredCapabilities: ['platform:lab', 'component:hybrid-auth', 'component:pq-keyset'],
    questions: [
      {
        id: 'protects',
        prompt: 'What are you protecting?',
        defaultOption: 'treasury',
        options: [
          { id: 'treasury', label: 'Crypto treasury', detail: 'Tokens held for the long term.', patch: { subject: 'CRYPTO TREASURY' } },
          { id: 'tokenized', label: 'Tokenized assets', detail: 'Real-world assets issued as tokens.', patch: { subject: 'TOKENIZED ASSETS' } },
          { id: 'protocol', label: 'Protocol treasury', detail: 'Funds controlled by a protocol or DAO.', patch: { subject: 'PROTOCOL TREASURY' } },
          { id: 'custom', label: 'Custom', detail: 'Something else.', patch: { subject: 'CUSTOM ASSETS' } },
        ],
      },
      {
        id: 'authorize',
        prompt: 'Who can authorize?',
        defaultOption: 'one',
        options: [
          { id: 'one', label: 'One owner', detail: 'A single owner approves withdrawals.', patch: { authorization: 'single-owner' } },
          { id: 'many', label: 'Multiple owners', detail: 'A set number of owners must approve together.', patch: { authorization: 'multi-owner', components: ['threshold-auth'] } },
          { id: 'org', label: 'Organization', detail: 'Roles and approval rules.', tag: 'COMING SOON', patch: { authorization: 'organization', components: ['threshold-auth', 'org-policy'] } },
        ],
      },
      {
        id: 'recovery',
        prompt: 'Recovery?',
        defaultOption: 'standard',
        options: [
          { id: 'standard', label: 'Standard', detail: 'A hash-based recovery key, committed now and revealed only to recover.', patch: { recovery: 'pq-commitment', components: ['pq-recovery'] } },
          { id: 'threshold', label: 'Threshold', detail: 'Recovery guardians approve together.', patch: { recovery: 'guardians', components: ['guardian-recovery'] } },
          { id: 'custom', label: 'Custom', detail: 'Choose the recovery components yourself in Expert Mode.', patch: { recovery: 'custom' } },
        ],
      },
      {
        id: 'security',
        prompt: 'Security profile?',
        defaultOption: 'recommended',
        options: [
          { id: 'recommended', label: 'Recommended', detail: 'Hybrid authorization with a post-quantum key architecture.', patch: { security: 'recommended' } },
          { id: 'advanced', label: 'Advanced', detail: 'Adds post-quantum key exchange between owners and any signing service.', patch: { security: 'advanced', components: ['signer-transport'] } },
        ],
      },
    ],
    qforkBurnModel: 'APPLICATION_MODULE',
    route: 'studio',
    cta: 'Build Quantum Vault',
    featured: true,
  },
  {
    id: 'QF-BP-003',
    slug: 'quantum-payments',
    index: '03',
    name: 'Quantum Payments',
    headline: 'Build a payment network for the post-quantum era.',
    description: 'A network tuned for moving value: low fees, a native settlement asset and a post-quantum migration profile from genesis.',
    category: 'NETWORK',
    visualType: 'payments',
    tone: 'yellow',
    visualLabels: ['SETTLEMENT', 'HYBRID SIGNATURES', 'FEE BURN'],
    ancestor: 'base',
    idealFor: ['PAYMENT RAILS', 'MERCHANT SETTLEMENT', 'STABLECOIN NETWORKS', 'REMITTANCE'],
    building: 'A Base-derived network configured for payments, where every transfer is authorized with both classical and post-quantum signatures.',
    configures: ['Fee level and where fees go', 'Throughput and node hardware', 'Post-quantum profile', 'RPC access'],
    securityModel: ['Every payment carries a classical and a post-quantum signature; both must verify.', 'Accounts can rotate keys without changing address.', 'Node and RPC connections negotiate hybrid post-quantum key exchange.'],
    remainsClassical: NETWORK_REMAINS_CLASSICAL,
    infrastructure: REGISTERED_INFRA,
    compatibility: [...NETWORK_COMPAT, { label: 'Wallets', verdict: 'BREAKING', detail: 'Payment apps and wallets need hybrid signing support.' }],
    limitations: ['Post-quantum signatures make each payment larger, which lowers peak throughput.', 'Every module is a design specification.'],
    recommendedGenome: { ...NETWORK_BASE, pqProfile: 'hybrid', security: 'recommended', network: network('QUANTUM PAYMENTS', 'QPAY', 'qf-quantum-payments', { baseFeeLamports: 1_000 }) },
    optionalModules: ['vid'],
    requiredCapabilities: ['platform:lab', 'module:cag', 'module:hsp', 'module:pqk', 'module:pqt'],
    questions: [
      {
        id: 'volume',
        prompt: 'What will it settle?',
        defaultOption: 'everyday',
        options: [
          { id: 'everyday', label: 'Everyday payments', detail: 'Low fees for frequent small transfers.', patch: { network: { baseFeeLamports: 1_000, validators: 32, hardware: 'standard' } } },
          { id: 'merchant', label: 'Merchant settlement', detail: 'Standard fees and a private RPC for your payment processors.', patch: { network: { baseFeeLamports: 5_000, rpc: 'private' } } },
          { id: 'volume', label: 'High volume', detail: '64 validators on high-performance hardware.', patch: { network: { baseFeeLamports: 1_000, validators: 64, hardware: 'high' } } },
        ],
      },
      {
        id: 'fees',
        prompt: 'Where do fees go?',
        defaultOption: 'split',
        options: [
          { id: 'burn', label: 'Burned', detail: 'Every fee is burned.', patch: { network: { burnPct: 100 } } },
          { id: 'split', label: 'Split', detail: 'Half burned, half to validators.', patch: { network: { burnPct: 50 } } },
          { id: 'validators', label: 'Validators', detail: 'Fees go to validators.', patch: { network: { burnPct: 0 } } },
        ],
      },
      SECURITY_QUESTION,
    ],
    qforkBurnModel: 'GENESIS',
    route: 'lab',
    cta: 'Build payment network',
    featured: true,
  },
  {
    id: 'QF-BP-004',
    slug: 'private-quantum-network',
    index: '04',
    name: 'Private Quantum Network',
    headline: 'Build privacy-oriented infrastructure with post-quantum migration in mind.',
    description: 'A restricted network with confidential balances available. Post-quantum privacy proofs are a research option, not a default.',
    category: 'NETWORK',
    visualType: 'membrane',
    tone: 'purple',
    visualLabels: ['RESTRICTED ACCESS', 'CONFIDENTIAL BALANCES', 'PQ SIGNATURES'],
    ancestor: 'base',
    idealFor: ['CONFIDENTIAL SETTLEMENT', 'PRIVATE CONSORTIA', 'SENSITIVE DATA RAILS', 'RESEARCH'],
    building: 'A Base-derived network with restricted access and, optionally, confidential balances. Signatures follow the chosen post-quantum profile.',
    configures: ['What stays private', 'How privacy proofs work', 'Who runs validators', 'RPC access'],
    securityModel: [
      'Access is restricted at the RPC layer.',
      'With confidential balances, amounts are hidden using today’s confidential-transfer proofs. Those proofs are classical.',
      'The post-quantum proof option replaces them with hash-based proofs and ML-KEM encryption. It is research only.',
    ],
    remainsClassical: [
      'Confidential-transfer proofs, unless the research option is chosen. They rely on pairing-based curves and are exposed to a quantum computer.',
      'Balances encrypted before any migration are not protected retroactively.',
      ...NETWORK_REMAINS_CLASSICAL.slice(0, 2),
    ],
    infrastructure: REGISTERED_INFRA,
    compatibility: [...NETWORK_COMPAT, { label: 'Privacy tooling', verdict: 'BREAKING', detail: 'Post-quantum proofs replace pairing-based privacy proofs entirely.' }],
    limitations: ['Post-quantum proof systems are not standardized.', 'A private RPC restricts access; it does not make the ledger itself secret.'],
    recommendedGenome: { ...NETWORK_BASE, pqProfile: 'hybrid', security: 'recommended', privacy: 'shielded', networkType: 'private', network: network('PRIVATE NETWORK', 'QPRV', 'qf-private-network', { validators: 16, rpc: 'private' }) },
    optionalModules: ['spq'],
    requiredCapabilities: ['platform:lab', 'module:cag', 'module:hsp', 'module:pqk'],
    questions: [
      {
        id: 'hide',
        prompt: 'What should stay private?',
        defaultOption: 'amounts',
        options: [
          { id: 'access', label: 'Who can connect', detail: 'A public ledger behind a private RPC.', patch: { privacy: 'public', network: { rpc: 'private' } } },
          { id: 'amounts', label: 'Balances and amounts', detail: 'Confidential balances behind a private RPC.', patch: { privacy: 'shielded', network: { rpc: 'private' } } },
        ],
      },
      {
        id: 'proofs',
        prompt: 'How should privacy proofs work?',
        defaultOption: 'today',
        showIf: { question: 'hide', oneOf: ['amounts'] },
        options: [
          { id: 'today', label: 'Today’s proofs', detail: 'The existing confidential-transfer proofs. They are classical, and the report says so.', patch: { privacy: 'shielded' } },
          { id: 'pq', label: 'Post-quantum proofs', detail: 'Hash-based proofs and ML-KEM encryption. Larger and slower.', tag: 'RESEARCH', patch: { privacy: 'shielded-pq' } },
        ],
      },
      {
        id: 'operators',
        prompt: 'Who runs the validators?',
        defaultOption: 'group',
        options: [
          { id: 'you', label: 'You', detail: '8 validators you operate.', patch: { network: { validators: 8 } } },
          { id: 'group', label: 'A small group', detail: '16 validators across trusted operators.', patch: { network: { validators: 16 } } },
          { id: 'open', label: 'An open set', detail: '32 validators.', patch: { network: { validators: 32 } } },
        ],
      },
    ],
    qforkBurnModel: 'GENESIS',
    route: 'lab',
    cta: 'Build private network',
    featured: true,
  },
  {
    id: 'QF-BP-005',
    slug: 'quantum-ai-economy',
    index: '05',
    name: 'Quantum AI Economy',
    headline: 'Give autonomous agents their own economy.',
    description: 'A network where AI agents hold wallets, pay each other and follow spending policies. The network genome can be designed today; registration opens once agent wallets and policies are built.',
    category: 'NETWORK',
    visualType: 'agents',
    tone: 'green',
    visualLabels: ['AGENT WALLETS', 'SPENDING POLICIES', 'M2M PAYMENTS'],
    ancestor: 'base',
    idealFor: ['AI AGENTS', 'MACHINE PAYMENTS', 'AUTONOMOUS MARKETS', 'AGENT APPLICATIONS'],
    building: 'A Base-derived network for machine-to-machine payments, with accounts owned by agents and limits set by their owners.',
    configures: ['Agent wallets', 'Spending policies', 'Programmable authorization', 'Native asset and fees', 'Machine-to-machine payment throughput', 'Post-quantum profile'],
    securityModel: [
      'Agent accounts use the same hybrid signatures as every other account on the network.',
      'Owners would bound what an agent can spend with policies. Policies are not specified yet.',
    ],
    remainsClassical: NETWORK_REMAINS_CLASSICAL,
    infrastructure: [...REGISTERED_INFRA.slice(0, 1), 'Agent wallets and spending policies do not exist, so only the network genome can be designed.'],
    compatibility: [...NETWORK_COMPAT, { label: 'Agent frameworks', verdict: 'UNSOLVED', detail: 'No agent SDK exists for this network.' }],
    limitations: ['Agent wallets and spending policies are not built.', 'Registration is disabled for this blueprint until they are.'],
    recommendedGenome: { ...NETWORK_BASE, pqProfile: 'hybrid', security: 'recommended', authorization: 'agent-policy', components: ['agent-wallets', 'spending-policy'], network: network('AGENT ECONOMY', 'QAGT', 'qf-agent-economy', { baseFeeLamports: 1_000 }) },
    optionalModules: ['vid'],
    requiredCapabilities: ['platform:lab', 'module:cag', 'module:hsp', 'module:pqk', 'component:agent-wallets', 'component:spending-policy'],
    questions: [
      {
        id: 'activity',
        prompt: 'What will your agents do?',
        defaultOption: 'services',
        options: [
          { id: 'services', label: 'Pay for services', detail: 'APIs, compute and data. Low fees on standard hardware.', patch: { network: { baseFeeLamports: 1_000, validators: 32, hardware: 'standard' } } },
          { id: 'trade', label: 'Trade with each other', detail: 'Autonomous markets. 64 validators on high-performance hardware.', patch: { network: { baseFeeLamports: 1_000, validators: 64, hardware: 'high' } } },
        ],
      },
      {
        id: 'limits',
        prompt: 'Who sets spending limits?',
        defaultOption: 'owner',
        options: [
          { id: 'owner', label: 'The owner', detail: 'Each agent’s owner sets its limits.', tag: 'COMING SOON', patch: { authorization: 'agent-policy' } },
          { id: 'org', label: 'An organization', detail: 'Limits come from organization policy.', tag: 'COMING SOON', patch: { authorization: 'organization', components: ['org-policy'] } },
        ],
      },
      SECURITY_QUESTION,
    ],
    qforkBurnModel: 'GENESIS',
    route: 'lab',
    cta: 'Build agent economy',
    featured: true,
  },
  {
    id: 'QF-BP-006',
    slug: 'enterprise-quantum-network',
    index: '06',
    name: 'Enterprise Quantum Network',
    headline: 'Create private blockchain infrastructure for an organization.',
    description: 'A small, organization-run network with private access and a post-quantum migration profile. Validator permissioning is not built yet.',
    category: 'NETWORK',
    visualType: 'enterprise',
    tone: 'steel',
    visualLabels: ['VALIDATOR ACCESS', 'POLICIES', 'MIGRATION PROFILE'],
    ancestor: 'base',
    idealFor: ['FINANCIAL INSTITUTIONS', 'CONSORTIA', 'INTERNAL SETTLEMENT', 'REGULATED ASSETS'],
    building: 'A Base-derived network run by your organization or a consortium, with private RPC access and a chosen migration profile.',
    configures: ['Validator access', 'Permissioning', 'Organization policies', 'Migration profile', 'RPC access'],
    securityModel: ['Accounts use hybrid signatures.', 'Access is restricted at the RPC layer.', 'Validator permissioning would restrict who can join consensus. It is not specified yet.'],
    remainsClassical: NETWORK_REMAINS_CLASSICAL,
    infrastructure: [...REGISTERED_INFRA.slice(0, 1), 'Permissioning does not exist, so only the network genome can be designed.'],
    compatibility: [...NETWORK_COMPAT, { label: 'Identity systems', verdict: 'UNSOLVED', detail: 'No integration with enterprise identity providers exists.' }],
    limitations: ['Validator permissioning and organization policies are not built.', 'Registration is disabled for this blueprint until they are.'],
    recommendedGenome: { ...NETWORK_BASE, pqProfile: 'hybrid', security: 'recommended', authorization: 'organization', networkType: 'permissioned', components: ['permissioning', 'org-policy'], network: network('ENTERPRISE NETWORK', 'QENT', 'qf-enterprise-network', { validators: 8, rpc: 'private', baseFeeLamports: 0, burnPct: 0 }) },
    optionalModules: ['vid'],
    requiredCapabilities: ['platform:lab', 'module:cag', 'module:hsp', 'module:pqk', 'component:permissioning'],
    questions: [
      {
        id: 'operators',
        prompt: 'Who runs the validators?',
        defaultOption: 'org',
        options: [
          { id: 'org', label: 'Your organization', detail: '8 validators you operate.', patch: { network: { validators: 8 } } },
          { id: 'consortium', label: 'A consortium', detail: '16 validators across member organizations.', patch: { network: { validators: 16 } } },
        ],
      },
      {
        id: 'access',
        prompt: 'Who can read the ledger?',
        defaultOption: 'private',
        options: [
          { id: 'private', label: 'Members only', detail: 'A private, authenticated RPC.', patch: { network: { rpc: 'private' } } },
          { id: 'public', label: 'Anyone can read', detail: 'A public RPC for transparency.', patch: { network: { rpc: 'public' } } },
        ],
      },
      { ...SECURITY_QUESTION, prompt: 'Migration profile?' },
    ],
    qforkBurnModel: 'GENESIS',
    route: 'lab',
    cta: 'Build enterprise network',
    featured: true,
  },
  {
    id: 'QF-BP-007',
    slug: 'quantumize-my-app',
    index: '07',
    name: 'Quantumize My App',
    headline: 'Prepare an existing application for the post-quantum future.',
    description: 'Scan an application’s code for the cryptography a quantum computer would break, and get the post-quantum replacement for each finding. Works on public GitHub repositories, local folders and pasted code.',
    category: 'APPLICATION',
    visualType: 'app-scan',
    tone: 'orange',
    visualLabels: ['SCAN', 'SURFACES FOUND', 'UPGRADES'],
    ancestor: 'your-application',
    idealFor: ['WEB APPS', 'APIS', 'WALLETS', 'DATA PLATFORMS'],
    building: 'An exposure report for your application: every place its code relies on cryptography a quantum computer would break or weaken, ranked by what to fix first, with the post-quantum replacement for each.',
    configures: ['Repository or folder scan', 'Findings ranked fix-first', 'Upgrade path and standard per finding', 'What cannot be fixed inside the app'],
    securityModel: [
      'Public GitHub repositories are downloaded by the server, scanned in memory and discarded. Nothing is stored.',
      'Local folders and pasted code are scanned in your browser. Nothing is uploaded.',
      'Reports show file paths, line numbers and short excerpts. Anything that looks like key material is redacted.',
      'Each upgrade points to a standard (FIPS 203, 204, 205) and to the libraries that implement it.',
    ],
    remainsClassical: ['Wallet signatures, which belong to the chain the app uses.', 'Third-party services the app calls, until they upgrade.'],
    infrastructure: ['Nothing is deployed. Upgrades are made in your own stack.'],
    compatibility: [
      { label: 'Your app', verdict: 'UNCHANGED', detail: 'Quantum Fork reads code; it never modifies or connects to your application.' },
      { label: 'Public GitHub repositories', verdict: 'COMPATIBLE', detail: 'Any public repository and branch, up to the scan limits.' },
      { label: 'Private repositories', verdict: 'PARTIAL', detail: 'Scan a local checkout in your browser instead.' },
    ],
    limitations: ['Pattern matching, not data-flow analysis: expect some false positives and misses.', 'Cryptography inside dependencies, your host or your CDN is not visible.'],
    recommendedGenome: { ...APPLICATION_BASE, authorization: 'single-owner', keyArchitecture: 'classical', recovery: 'none', networkType: 'existing-app', components: ['surface-map', 'tls-upgrade'], subject: 'WEB OR API SERVICE' },
    optionalModules: [],
    requiredCapabilities: ['platform:lab', 'component:surface-map', 'component:repo-scan'],
    questions: [
      {
        id: 'kind',
        prompt: 'What is your app?',
        defaultOption: 'service',
        options: [
          { id: 'service', label: 'Web or API service', detail: 'Served over TLS.', patch: { subject: 'WEB OR API SERVICE' } },
          { id: 'wallet', label: 'Wallet or signing app', detail: 'Holds or uses users’ chain keys.', patch: { subject: 'WALLET OR SIGNING APP', components: ['wallet-bound'] } },
          { id: 'data', label: 'Data platform', detail: 'Stores data for others.', patch: { subject: 'DATA PLATFORM', components: ['data-keys'] } },
        ],
      },
      {
        id: 'signin',
        prompt: 'How do users sign in?',
        defaultOption: 'sessions',
        options: [
          { id: 'sessions', label: 'Passwords and sessions', detail: 'Password hashes are not materially affected by quantum computers.', patch: {} },
          { id: 'tokens', label: 'Signed tokens', detail: 'JWTs or other signed session and API tokens.', patch: { components: ['token-signing'] } },
          { id: 'wallet', label: 'Wallet signatures', detail: 'Users sign in with a chain wallet.', patch: { components: ['wallet-bound'] } },
        ],
      },
      {
        id: 'longevity',
        prompt: 'Must data stay secret for years?',
        defaultOption: 'no',
        options: [
          { id: 'no', label: 'No', detail: 'Short-lived data only.', patch: {} },
          { id: 'yes', label: 'Yes', detail: 'Recorded traffic or stored keys must not be decryptable later.', patch: { components: ['data-keys'] } },
        ],
      },
    ],
    qforkBurnModel: 'NONE',
    route: 'studio',
    cta: 'Scan my app',
    featured: false,
  },
  {
    id: 'QF-BP-008',
    slug: 'quantumize-my-chain',
    index: '08',
    name: 'Quantumize My Chain',
    headline: 'Find your blockchain’s quantum exposure.',
    description: 'Scan a supported blockchain’s architecture, find its cryptographic dependencies and generate a migration or descendant plan. Base and Solana are sequenced.',
    category: 'APPLICATION',
    visualType: 'chain-scan',
    tone: 'red',
    visualLabels: ['SCAN', 'EXPOSURE', 'MIGRATION PLAN'],
    ancestor: 'scanned-chain',
    idealFor: ['PROTOCOL TEAMS', 'RESEARCHERS', 'VALIDATORS', 'RISK REVIEWS'],
    building: 'An exposure map of a chain’s cryptography, then a descendant plan in the lab if you want one.',
    configures: ['Which chain to scan', 'Exposure map with sources', 'Migration options per dependency'],
    securityModel: ['The exposure model is mapped by hand, and every finding cites its source.'],
    remainsClassical: ['The scanned chain itself. Scanning changes nothing.'],
    infrastructure: ['The scanner runs in your browser. Nothing is deployed.'],
    compatibility: [{ label: 'Supported chains', verdict: 'PARTIAL', detail: 'Base and Solana. Other chains are not sequenced yet.' }],
    limitations: ['Two ancestors sequenced: Base and Solana.', 'Mapped by hand from public sources; it can lag upstream changes.'],
    recommendedGenome: { ...APPLICATION_BASE, authorization: 'network-accounts', keyArchitecture: 'classical', recovery: 'none', networkType: 'existing-chain', components: [], subject: 'BASE' },
    optionalModules: [],
    requiredCapabilities: ['platform:scanner', 'platform:lab'],
    questions: [
      {
        id: 'chain',
        prompt: 'Which chain?',
        defaultOption: 'base',
        options: ANCESTORS.map((ancestor) => ({
          id: ancestor.id,
          label: ancestor.name.charAt(0) + ancestor.name.slice(1).toLowerCase(),
          detail: ancestor.status === 'AVAILABLE' ? (ancestor.scope ?? 'Sequenced.') : 'Not sequenced yet.',
          patch: { subject: ancestor.name },
          ...(ancestor.status === 'AVAILABLE' ? {} : { disabled: 'NOT YET SEQUENCED' }),
        })),
      },
    ],
    qforkBurnModel: 'NONE',
    route: 'scanner',
    cta: 'Scan a chain',
    featured: false,
  },
  {
    id: 'QF-BP-009',
    slug: 'custom',
    index: '09',
    name: 'Custom',
    headline: 'Design your own cryptographic species.',
    description: 'Expert Mode. Start from Base and choose every module, profile and network parameter yourself.',
    category: 'EXPERT',
    visualType: 'helix',
    tone: 'lime',
    visualLabels: ['EVERY GENE', 'EVERY PARAMETER'],
    ancestor: 'base',
    idealFor: ['CRYPTOGRAPHERS', 'PROTOCOL ENGINEERS', 'RESEARCH'],
    building: 'Whatever you design. The lab exposes every module, dependency and parameter.',
    configures: ['Nothing automatically. You choose.'],
    securityModel: ['You are responsible for the combination. Dependencies are added automatically; unusual combinations receive the least review.'],
    remainsClassical: ['Whatever your selection leaves unchanged. The lab’s diff shows every remaining classical dependency.'],
    infrastructure: REGISTERED_INFRA,
    compatibility: NETWORK_COMPAT,
    limitations: ['Every module is a design specification.'],
    recommendedGenome: { ...NETWORK_BASE, pqProfile: 'custom', security: 'advanced', network: network('CUSTOM SPECIES', 'QCUS', 'qf-custom-species') },
    optionalModules: ['vid', 'wcl', 'spq', 'lsp', 'bmp', 'pqt', 'pqr'],
    requiredCapabilities: ['platform:lab', 'module:cag'],
    questions: [],
    qforkBurnModel: 'GENESIS',
    route: 'expert',
    cta: 'Open expert lab',
    featured: false,
  },
]

export const BLUEPRINT_BY_SLUG: Record<string, Blueprint> = Object.fromEntries(BLUEPRINTS.map((item) => [item.slug, item]))

export function findBlueprint(slug: string | null | undefined): Blueprint | null {
  if (!slug) return null
  return Object.hasOwn(BLUEPRINT_BY_SLUG, slug) ? BLUEPRINT_BY_SLUG[slug] : null
}

export const FEATURED_BLUEPRINTS = BLUEPRINTS.filter((item) => item.featured)

export const BLUEPRINT_GROUPS: { category: BlueprintCategory; title: string; lede: string }[] = [
  { category: 'NETWORK', title: 'Network blueprints', lede: 'Each one launches a new Base-derived network with its own genesis.' },
  { category: 'APPLICATION', title: 'Application blueprints', lede: 'Each one protects or examines something that already exists. None of them launches a blockchain.' },
  { category: 'EXPERT', title: 'Expert', lede: 'Every gene, by hand.' },
]

/** Universal onboarding: plain-language intents, each resolved to one blueprint. */
export const INTENTS: { id: string; label: string; detail: string; slug: string }[] = [
  { id: 'chain', label: 'Launch a blockchain', detail: 'Your own network, with its own genesis.', slug: 'quantum-chain' },
  { id: 'protect', label: 'Protect digital assets', detail: 'A vault that holds assets behind post-quantum keys.', slug: 'quantum-vault' },
  { id: 'payments', label: 'Build a payment network', detail: 'Fast, low-fee payments on a network you launch.', slug: 'quantum-payments' },
  { id: 'agents', label: 'Build for AI agents', detail: 'An economy where autonomous agents hold and spend funds.', slug: 'quantum-ai-economy' },
  { id: 'private', label: 'Create a private network', detail: 'Restricted access and confidential balances.', slug: 'private-quantum-network' },
  { id: 'enterprise', label: 'Build an enterprise network', detail: 'Approved validators, run for one organization.', slug: 'enterprise-quantum-network' },
  { id: 'app', label: 'Upgrade an existing app', detail: 'Find the cryptography in your code a quantum computer breaks.', slug: 'quantumize-my-app' },
  { id: 'existing-chain', label: 'Upgrade an existing chain', detail: 'See what a quantum computer would break in Base.', slug: 'quantumize-my-chain' },
  { id: 'expert', label: 'Custom / Expert mode', detail: 'Every module and parameter, by hand.', slug: 'custom' },
]
