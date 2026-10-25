import { keccak256, stringToBytes } from 'viem'
import { z } from 'zod'
import type { SourceId } from './sources.js'

/**
 * Chain DNA: one schema for every environment Quantum Fork can describe. Each option states,
 * per target, whether the target provides it, needs your own contracts, needs dedicated chain
 * infrastructure, is research only, or is impossible there. Nothing here deploys anything.
 */
export const DNA_SPEC = 'qfork/chain-dna/v1'

export const TARGET_IDS = ['base', 'local-devnet', 'op-stack'] as const
export type Target = (typeof TARGET_IDS)[number]

export const TARGETS: Record<Target, { label: string; short: string; summary: string; independent: boolean }> = {
  base: {
    label: 'Contracts on Base',
    short: 'BASE',
    summary: 'Your contracts on Base. Base fixes block time, gas, fees and consensus; you configure everything your contracts control. This is an application, not a separate chain.',
    independent: false,
  },
  'local-devnet': {
    label: 'Local devnet (Anvil)',
    short: 'DEVNET',
    summary: 'An isolated Anvil node on your machine, optionally forked from Base state. For development only; nothing on it has value or reaches Base.',
    independent: false,
  },
  'op-stack': {
    label: 'Dedicated OP Stack rollup',
    short: 'ROLLUP',
    summary: 'Your own chain: sequencer, batcher, proposer and settlement contracts. Needs infrastructure Quantum Fork does not operate yet.',
    independent: true,
  },
}

export type Support = 'native' | 'contracts' | 'infrastructure' | 'research' | 'unsupported'

export const SUPPORT: Record<Support, { label: string; meaning: string; rank: number }> = {
  native: { label: 'BUILT IN', meaning: 'Provided by the target as it runs today.', rank: 0 },
  contracts: { label: 'YOUR CONTRACTS', meaning: 'Possible on this target by deploying smart contracts. Quantum Fork does not deploy them for you yet.', rank: 1 },
  infrastructure: { label: 'NEEDS INFRASTRUCTURE', meaning: 'Needs dedicated chain infrastructure (nodes, sequencer, settlement contracts).', rank: 2 },
  research: { label: 'RESEARCH', meaning: 'No production implementation exists. Can be designed, not deployed.', rank: 3 },
  unsupported: { label: 'NOT POSSIBLE', meaning: 'Cannot be done on this target.', rank: 4 },
}

/** Where a change lands. Drives upgrade classification: only the first two can ship as contracts on Base. */
export type Layer = 'contract' | 'application' | 'infrastructure' | 'execution-client' | 'consensus'

export const LAYERS: Record<Layer, string> = {
  contract: 'Smart-contract level',
  application: 'Application level',
  infrastructure: 'Infrastructure',
  'execution-client': 'Execution client',
  consensus: 'Consensus',
}

export const CATEGORIES = ['network', 'economics', 'execution', 'security', 'privacy', 'cryptography'] as const
export type Category = (typeof CATEGORIES)[number]

const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{2,39}$/
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$/
const sorted = <T extends string>(values: T[]) => [...new Set(values)].sort() as T[]

export const chainDnaSchema = z
  .object({
    spec: z.literal(DNA_SPEC),
    name: z.string().regex(NAME, 'Use 3–40 characters: letters, digits, spaces, dots, dashes or underscores.'),
    description: z.string().max(280),
    target: z.enum(TARGET_IDS),
    network: z
      .object({
        chainId: z.number().int().min(1).max(4_294_967_295),
        settlement: z.enum(['base', 'base-sepolia', 'ethereum', 'sepolia']).nullable(),
        fork: z.object({ source: z.enum(['base', 'base-sepolia']), block: z.number().int().min(1).nullable() }).strict().nullable(),
        access: z.enum(['public', 'private', 'allowlist']),
        blockTimeMs: z.number().int().min(0).max(60_000),
        gasLimit: z.number().int().min(1_000_000).max(2_000_000_000).nullable(),
      })
      .strict(),
    economics: z
      .object({
        nativeCurrency: z.enum(['eth', 'custom']),
        baseFeeGwei: z.number().min(0).max(1_000).nullable(),
        feePolicy: z.enum(['user-pays', 'sponsored', 'zero-fee']),
        treasury: z.enum(['none', 'multisig', 'contract']),
        token: z.enum(['none', 'erc20', 'clanker']),
        distribution: z
          .array(z.object({ label: z.string().regex(LABEL, 'Use 1–32 letters, digits, spaces, dots, dashes or underscores.'), pct: z.number().int().min(1).max(100) }).strict())
          .max(8),
      })
      .strict(),
    execution: z
      .object({
        evm: z.enum(['prague', 'cancun']),
        precompiles: z.array(z.enum(['p256', 'bls12-381', 'custom'])).max(3),
        accountAbstraction: z.array(z.enum(['erc4337', 'eip7702'])).max(2),
        upgrades: z.enum(['immutable', 'uups', 'transparent']),
      })
      .strict(),
    security: z
      .object({
        admin: z.enum(['none', 'eoa', 'multisig', 'timelock']),
        governance: z.enum(['none', 'multisig', 'token-vote']),
        sequencing: z.enum(['platform', 'single', 'decentralized']),
        keys: z.enum(['wallet', 'hardware', 'smart-account']),
      })
      .strict(),
    privacy: z
      .object({
        execution: z.enum(['public', 'confidential']),
        zkVerifier: z.enum(['none', 'groth16', 'ultrahonk']),
        disclosure: z.enum(['none', 'commitments']),
      })
      .strict(),
    cryptography: z
      .object({
        auth: z.enum(['ecdsa', 'passkey', 'hybrid-mldsa', 'mldsa']),
        rotation: z.enum(['none', 'smart-account']),
      })
      .strict(),
  })
  .strict()

export type ChainDna = z.infer<typeof chainDnaSchema>

/* ---------- option catalog ---------- */

type PerTarget = Record<Target, Support>
const all = (support: Support): PerTarget => ({ base: support, 'local-devnet': support, 'op-stack': support })

export interface OptionMeta {
  label: string
  detail: string
  support: PerTarget
  /** Per-target caveat shown next to the support level. */
  notes?: Partial<Record<Target, string>>
  sources?: SourceId[]
}

export interface FieldMeta {
  path: string
  label: string
  category: Category
  layer: Layer
  multi?: boolean
  options: Record<string, OptionMeta>
}

const FIELD_LIST: FieldMeta[] = [
  {
    path: 'network.settlement',
    label: 'Network / settlement',
    category: 'network',
    layer: 'infrastructure',
    options: {
      base: { label: 'Base mainnet', detail: 'Chain 8453. Real ETH.', support: { base: 'native', 'local-devnet': 'unsupported', 'op-stack': 'infrastructure' }, notes: { 'op-stack': 'An L3 that settles to Base.' } },
      'base-sepolia': { label: 'Base Sepolia', detail: 'Chain 84532. Test ETH, no value.', support: { base: 'native', 'local-devnet': 'unsupported', 'op-stack': 'infrastructure' }, notes: { 'op-stack': 'A test L3 that settles to Base Sepolia.' } },
      ethereum: { label: 'Ethereum mainnet', detail: 'An L2 that settles to Ethereum, like Base itself.', support: { base: 'unsupported', 'local-devnet': 'unsupported', 'op-stack': 'infrastructure' } },
      sepolia: { label: 'Ethereum Sepolia', detail: 'A test L2 that settles to Sepolia.', support: { base: 'unsupported', 'local-devnet': 'unsupported', 'op-stack': 'infrastructure' } },
    },
  },
  {
    path: 'network.access',
    label: 'Network access',
    category: 'network',
    layer: 'infrastructure',
    options: {
      public: { label: 'Public', detail: 'Anyone can read state and send transactions.', support: { base: 'native', 'local-devnet': 'native', 'op-stack': 'infrastructure' }, notes: { 'local-devnet': 'Public to your machine: Anvil binds to 127.0.0.1.' } },
      private: {
        label: 'Private RPC',
        detail: 'Only authorised clients reach the RPC.',
        support: { base: 'unsupported', 'local-devnet': 'native', 'op-stack': 'infrastructure' },
        notes: { base: 'Base state is public. A private RPC hides nothing from the chain.', 'op-stack': 'Transaction data is still posted publicly to the settlement layer.' },
      },
      allowlist: {
        label: 'Sender allowlist',
        detail: 'Only approved addresses can act.',
        support: { base: 'contracts', 'local-devnet': 'contracts', 'op-stack': 'research' },
        notes: { base: 'Enforced by your contracts, for your contracts only.', 'op-stack': 'Chain-wide filtering needs a modified sequencer.' },
      },
    },
  },
  {
    path: 'economics.nativeCurrency',
    label: 'Native currency',
    category: 'economics',
    layer: 'execution-client',
    options: {
      eth: { label: 'ETH', detail: 'Gas is paid in ETH.', support: { base: 'native', 'local-devnet': 'native', 'op-stack': 'infrastructure' } },
      custom: { label: 'Custom gas token', detail: 'Gas paid in your own token.', support: { base: 'unsupported', 'local-devnet': 'unsupported', 'op-stack': 'research' }, notes: { 'op-stack': 'Not part of the standard OP Stack configuration.' } },
    },
  },
  {
    path: 'economics.feePolicy',
    label: 'Fee policy',
    category: 'economics',
    layer: 'application',
    options: {
      'user-pays': { label: 'User pays gas', detail: 'EIP-1559 fees paid by the sender.', support: all('native') },
      sponsored: { label: 'Sponsored (paymaster)', detail: 'An ERC-4337 paymaster pays gas for your users.', support: all('contracts'), sources: ['erc-4337'] },
      'zero-fee': { label: 'Zero base fee', detail: 'Transactions cost nothing.', support: { base: 'unsupported', 'local-devnet': 'native', 'op-stack': 'infrastructure' }, notes: { 'op-stack': 'Invites spam; the operator still pays for settlement data.' } },
    },
  },
  {
    path: 'economics.treasury',
    label: 'Treasury',
    category: 'economics',
    layer: 'contract',
    options: {
      none: { label: 'None', detail: 'No protocol-held funds.', support: all('native') },
      multisig: { label: 'Multisig (Safe)', detail: 'Funds held by an M-of-N Safe.', support: all('contracts') },
      contract: { label: 'Treasury contract', detail: 'Rules-based release from a contract.', support: all('contracts') },
    },
  },
  {
    path: 'economics.token',
    label: 'Token',
    category: 'economics',
    layer: 'contract',
    options: {
      none: { label: 'None', detail: 'No token.', support: all('native') },
      erc20: { label: 'ERC-20', detail: 'A standard token contract you deploy.', support: all('contracts') },
      clanker: {
        label: 'Clanker v4',
        detail: 'Fixed 100B supply, Uniswap v4 pool, through the Clanker factory.',
        support: { base: 'native', 'local-devnet': 'unsupported', 'op-stack': 'unsupported' },
        notes: { base: 'Launchable today only for registered Quantum Fork descendants.' },
      },
    },
  },
  {
    path: 'execution.evm',
    label: 'EVM version',
    category: 'execution',
    layer: 'execution-client',
    options: {
      prague: { label: 'Prague', detail: 'Includes EIP-7702 and the BLS12-381 precompiles.', support: { base: 'native', 'local-devnet': 'native', 'op-stack': 'infrastructure' }, notes: { base: 'Base activated these with Isthmus.' }, sources: ['base-isthmus'] },
      cancun: { label: 'Cancun', detail: 'The previous EVM version.', support: { base: 'unsupported', 'local-devnet': 'native', 'op-stack': 'infrastructure' }, notes: { base: 'Base has upgraded past Cancun.' } },
    },
  },
  {
    path: 'execution.precompiles',
    label: 'Precompiles',
    category: 'execution',
    layer: 'execution-client',
    multi: true,
    options: {
      p256: { label: 'P-256 verify', detail: 'secp256r1 verification (passkeys), RIP-7212.', support: { base: 'native', 'local-devnet': 'native', 'op-stack': 'infrastructure' }, notes: { 'local-devnet': 'Runs Anvil in its OP Stack mode, as Base does.' }, sources: ['base-fjord', 'rip-7212'] },
      'bls12-381': { label: 'BLS12-381', detail: 'Pairing-friendly curve operations, EIP-2537.', support: { base: 'native', 'local-devnet': 'native', 'op-stack': 'infrastructure' }, notes: { 'local-devnet': 'Needs the Prague EVM.' }, sources: ['eip-2537', 'base-isthmus'] },
      custom: { label: 'Custom precompile', detail: 'A new native function, e.g. ML-DSA verification.', support: { base: 'unsupported', 'local-devnet': 'research', 'op-stack': 'research' }, notes: { 'op-stack': 'Needs a modified execution client and fault-proof program.' } },
    },
  },
  {
    path: 'execution.accountAbstraction',
    label: 'Account abstraction',
    category: 'execution',
    layer: 'contract',
    multi: true,
    options: {
      erc4337: { label: 'ERC-4337', detail: 'Smart accounts through the EntryPoint and bundlers.', support: { base: 'native', 'local-devnet': 'contracts', 'op-stack': 'contracts' }, notes: { 'local-devnet': 'Deploy the EntryPoint, or fork Base where it exists.' }, sources: ['erc-4337'] },
      eip7702: { label: 'EIP-7702', detail: 'EOAs delegate to contract code.', support: { base: 'native', 'local-devnet': 'native', 'op-stack': 'infrastructure' }, sources: ['eip-7702'] },
    },
  },
  {
    path: 'execution.upgrades',
    label: 'Upgrade architecture',
    category: 'execution',
    layer: 'contract',
    options: {
      immutable: { label: 'Immutable', detail: 'Contracts can never change.', support: all('native') },
      uups: { label: 'UUPS proxy', detail: 'The implementation authorises its own upgrades.', support: all('contracts') },
      transparent: { label: 'Transparent proxy', detail: 'A separate admin upgrades the proxy.', support: all('contracts') },
    },
  },
  {
    path: 'security.admin',
    label: 'Admin permissions',
    category: 'security',
    layer: 'contract',
    options: {
      none: { label: 'No admin', detail: 'Nobody holds privileged roles.', support: all('native') },
      eoa: { label: 'Single key', detail: 'One externally owned account.', support: all('contracts') },
      multisig: { label: 'Multisig', detail: 'M-of-N Safe.', support: all('contracts') },
      timelock: { label: 'Timelocked multisig', detail: 'Multisig actions wait out a public delay.', support: all('contracts') },
    },
  },
  {
    path: 'security.governance',
    label: 'Governance',
    category: 'security',
    layer: 'contract',
    options: {
      none: { label: 'None', detail: 'No on-chain governance.', support: all('native') },
      multisig: { label: 'Multisig', detail: 'Signers decide.', support: all('contracts') },
      'token-vote': { label: 'Token vote', detail: 'Token holders vote through a governor contract.', support: all('contracts') },
    },
  },
  {
    path: 'security.sequencing',
    label: 'Block production',
    category: 'security',
    layer: 'consensus',
    options: {
      platform: { label: 'Set by Base', detail: 'Base’s sequencer orders transactions.', support: { base: 'native', 'local-devnet': 'unsupported', 'op-stack': 'unsupported' }, sources: ['l2beat-base'] },
      single: { label: 'Single sequencer', detail: 'One operator orders transactions.', support: { base: 'unsupported', 'local-devnet': 'native', 'op-stack': 'infrastructure' }, notes: { 'local-devnet': 'One Anvil process mines every block.' } },
      decentralized: { label: 'Decentralised sequencing', detail: 'Several operators order transactions.', support: { base: 'unsupported', 'local-devnet': 'unsupported', 'op-stack': 'research' } },
    },
  },
  {
    path: 'security.keys',
    label: 'Key management',
    category: 'security',
    layer: 'application',
    options: {
      wallet: { label: 'Browser wallet', detail: 'Keys stay in the user’s wallet.', support: all('native') },
      hardware: { label: 'Hardware wallet', detail: 'Keys stay on a hardware device.', support: all('native') },
      'smart-account': { label: 'Smart account', detail: 'Authorisation defined by contract code.', support: all('contracts') },
    },
  },
  {
    path: 'privacy.execution',
    label: 'Execution privacy',
    category: 'privacy',
    layer: 'execution-client',
    options: {
      public: { label: 'Public', detail: 'All state, calldata and events are public.', support: all('native') },
      confidential: { label: 'Confidential execution', detail: 'State hidden from the public.', support: { base: 'research', 'local-devnet': 'unsupported', 'op-stack': 'research' }, notes: { base: 'Base has no private execution. Only proofs over private inputs are possible.' } },
    },
  },
  {
    path: 'privacy.zkVerifier',
    label: 'Zero-knowledge verifier',
    category: 'privacy',
    layer: 'contract',
    options: {
      none: { label: 'None', detail: 'No proof verification.', support: all('native') },
      groth16: { label: 'Groth16', detail: 'Verifier contract on the BN254 pairing precompiles. Needs a trusted setup.', support: all('contracts') },
      ultrahonk: { label: 'UltraHonk (Noir)', detail: 'Verifier contract generated by Barretenberg. No per-circuit trusted setup.', support: all('contracts') },
    },
  },
  {
    path: 'privacy.disclosure',
    label: 'Selective disclosure',
    category: 'privacy',
    layer: 'contract',
    options: {
      none: { label: 'None', detail: 'Values are public or absent.', support: all('native') },
      commitments: { label: 'Commitments', detail: 'Publish hashes; reveal values to chosen parties.', support: all('contracts') },
    },
  },
  {
    path: 'cryptography.auth',
    label: 'Authentication',
    category: 'cryptography',
    layer: 'contract',
    options: {
      ecdsa: { label: 'ECDSA (secp256k1)', detail: 'Ethereum’s standard signatures. Classical.', support: all('native') },
      passkey: { label: 'Passkeys (P-256)', detail: 'WebAuthn keys through a smart account.', support: all('contracts'), sources: ['coinbase-smart-wallet', 'rip-7212'] },
      'hybrid-mldsa': {
        label: 'Hybrid ECDSA + ML-DSA',
        detail: 'Both signatures required by a smart account.',
        support: all('research'),
        notes: { base: 'No ML-DSA precompile. On-chain ML-DSA verifiers are unaudited prototypes.' },
        sources: ['fips-204', 'eth-pq'],
      },
      mldsa: { label: 'ML-DSA only', detail: 'Post-quantum signatures alone.', support: all('research'), notes: { base: 'Base transactions are still signed with secp256k1 by the sender or bundler.' }, sources: ['fips-204', 'base-8130'] },
    },
  },
  {
    path: 'cryptography.rotation',
    label: 'Key rotation',
    category: 'cryptography',
    layer: 'contract',
    options: {
      none: { label: 'None', detail: 'An EOA key can never change.', support: all('native') },
      'smart-account': { label: 'Smart-account rotation', detail: 'Owners can replace signing keys.', support: all('contracts') },
    },
  },
]

export const FIELDS: readonly FieldMeta[] = FIELD_LIST
export const FIELD_BY_PATH = Object.fromEntries(FIELD_LIST.map((field) => [field.path, field])) as Record<string, FieldMeta>

export function getPath(dna: ChainDna, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | null)?.[key], dna)
}

/** Every chosen option, with its support level on the chosen target. */
export function chosenOptions(dna: ChainDna) {
  const chosen: { field: FieldMeta; value: string; option: OptionMeta; support: Support }[] = []
  for (const field of FIELD_LIST) {
    const raw = getPath(dna, field.path)
    if (raw === null || raw === undefined) continue
    for (const value of field.multi ? (raw as string[]) : [raw as string]) {
      const option = field.options[value]
      if (option) chosen.push({ field, value, option, support: option.support[dna.target] })
    }
  }
  return chosen
}

/* ---------- defaults and normalisation ---------- */

export const BASE_CHAIN_IDS = { base: 8453, 'base-sepolia': 84532 } as const
/** Public chain IDs a dedicated rollup must not reuse. Not exhaustive: check chainlist before launch. */
export const RESERVED_CHAIN_IDS = new Map<number, string>([
  [1, 'Ethereum'],
  [10, 'OP Mainnet'],
  [56, 'BNB Chain'],
  [137, 'Polygon'],
  [8453, 'Base'],
  [42161, 'Arbitrum One'],
  [84532, 'Base Sepolia'],
  [11155111, 'Sepolia'],
  [11155420, 'OP Sepolia'],
])

export function defaultDna(target: Target = 'base'): ChainDna {
  return normalizeDna({
    spec: DNA_SPEC,
    name: target === 'op-stack' ? 'Quantum Rollup' : target === 'local-devnet' ? 'Quantum Devnet' : 'Quantum App',
    description: '',
    target,
    network: { chainId: target === 'local-devnet' ? 31337 : 990_001, settlement: 'base-sepolia', fork: null, access: 'public', blockTimeMs: 2000, gasLimit: 30_000_000 },
    economics: { nativeCurrency: 'eth', baseFeeGwei: 0.01, feePolicy: 'user-pays', treasury: 'none', token: 'none', distribution: [] },
    execution: { evm: 'prague', precompiles: ['bls12-381', 'p256'], accountAbstraction: ['eip7702', 'erc4337'], upgrades: 'immutable' },
    security: { admin: 'none', governance: 'none', sequencing: 'platform', keys: 'wallet' },
    privacy: { execution: 'public', zkVerifier: 'none', disclosure: 'none' },
    cryptography: { auth: 'ecdsa', rotation: 'none' },
  })
}

/**
 * Applies what the target fixes, so the studio never offers a value the target ignores.
 * Imported documents are validated before normalisation, so their problems are still reported.
 */
export function normalizeDna(dna: ChainDna): ChainDna {
  const next: ChainDna = structuredClone(dna)
  next.execution.precompiles = sorted(next.execution.precompiles)
  next.execution.accountAbstraction = sorted(next.execution.accountAbstraction)
  if (next.target === 'base') {
    const settlement = next.network.settlement === 'base' ? 'base' : 'base-sepolia'
    next.network = { ...next.network, settlement, chainId: BASE_CHAIN_IDS[settlement], fork: null, blockTimeMs: 2000, gasLimit: null }
    next.economics.baseFeeGwei = null
    next.execution.evm = 'prague'
    next.execution.precompiles = ['bls12-381', 'p256']
    next.security.sequencing = 'platform'
  }
  if (next.target === 'local-devnet') {
    next.network.settlement = null
    next.network.gasLimit ??= 30_000_000
    next.network.blockTimeMs = Math.round(next.network.blockTimeMs / 1000) * 1000
    next.economics.baseFeeGwei ??= 0
    next.security.sequencing = 'single'
  }
  if (next.target === 'op-stack') {
    next.network.fork = null
    next.network.settlement ??= 'sepolia'
    next.network.gasLimit ??= 30_000_000
    next.network.blockTimeMs = Math.max(1000, Math.round(next.network.blockTimeMs / 1000) * 1000)
    next.economics.baseFeeGwei ??= 0
    if (next.security.sequencing === 'platform') next.security.sequencing = 'single'
  }
  if (next.economics.token === 'none') next.economics.distribution = []
  return next
}

export function retarget(dna: ChainDna, target: Target): ChainDna {
  const next = structuredClone(dna)
  next.target = target
  if (target !== 'base' && next.economics.token === 'clanker') next.economics.token = 'erc20'
  if (target === 'local-devnet') next.network.chainId = 31337
  if (target === 'op-stack') {
    next.network.chainId = RESERVED_CHAIN_IDS.has(next.network.chainId) || next.network.chainId === 31337 ? 990_001 : next.network.chainId
    next.network.settlement = next.network.settlement ?? 'sepolia'
  }
  return normalizeDna(next)
}

/* ---------- validation ---------- */

export interface DnaIssue {
  level: 'error' | 'warning'
  path: string
  message: string
}

/** Compatibility checks. Errors make a configuration invalid; warnings explain risk or limits. */
export function validateDna(dna: ChainDna): DnaIssue[] {
  const issues: DnaIssue[] = []
  const error = (path: string, message: string) => issues.push({ level: 'error', path, message })
  const warn = (path: string, message: string) => issues.push({ level: 'warning', path, message })
  const target = TARGETS[dna.target]

  for (const { field, option, support } of chosenOptions(dna)) {
    const note = option.notes?.[dna.target]
    if (support === 'unsupported') error(field.path, `${option.label} is not possible on ${target.label.toLowerCase()}.${note ? ` ${note}` : ''}`)
    if (support === 'research') warn(field.path, `${option.label} is research only: it can be designed here but not deployed.${note ? ` ${note}` : ''}`)
  }

  const { network, economics, execution, security, cryptography } = dna
  if (dna.target === 'base') {
    if (!network.settlement || !(network.settlement in BASE_CHAIN_IDS)) error('network.settlement', 'Choose Base mainnet or Base Sepolia.')
    else if (network.chainId !== BASE_CHAIN_IDS[network.settlement as keyof typeof BASE_CHAIN_IDS]) error('network.chainId', `Contracts on ${network.settlement} run on chain ${BASE_CHAIN_IDS[network.settlement as keyof typeof BASE_CHAIN_IDS]}.`)
    if (network.blockTimeMs !== 2000) error('network.blockTimeMs', 'Base produces a block every 2 seconds. Contracts cannot change that.')
    if (network.gasLimit !== null) error('network.gasLimit', 'Base sets its own block gas limit.')
    if (economics.baseFeeGwei !== null) error('economics.baseFeeGwei', 'Base sets its own base fee.')
    if (network.fork) error('network.fork', 'Forking applies to local devnets only.')
  }
  if (dna.target === 'local-devnet') {
    if (network.settlement !== null) error('network.settlement', 'A local devnet settles nowhere.')
    if (network.blockTimeMs % 1000 !== 0) error('network.blockTimeMs', 'Anvil block time is set in whole seconds; 0 mines on every transaction.')
    if (network.fork && network.chainId === BASE_CHAIN_IDS[network.fork.source]) {
      warn('network.chainId', `The fork reuses chain ${network.chainId}. Transactions signed for it are valid on ${network.fork.source}. Use a distinct chain ID unless you need exact replay.`)
    }
    if (network.fork && execution.evm === 'cancun') warn('execution.evm', 'Base runs Prague-era rules; a Cancun fork of Base will not match it.')
    if (execution.evm === 'cancun' && execution.precompiles.includes('bls12-381')) error('execution.precompiles', 'BLS12-381 precompiles arrived with Prague; a Cancun devnet does not have them.')
    if (execution.evm === 'cancun' && execution.accountAbstraction.includes('eip7702')) error('execution.accountAbstraction', 'EIP-7702 arrived with Prague; a Cancun devnet does not support it.')
  }
  if (dna.target === 'op-stack') {
    const reserved = RESERVED_CHAIN_IDS.get(network.chainId)
    if (reserved) error('network.chainId', `Chain ID ${network.chainId} belongs to ${reserved}.`)
    if (network.chainId === 31337) error('network.chainId', '31337 is the local development chain ID.')
    if (network.blockTimeMs < 1000 || network.blockTimeMs % 1000 !== 0) error('network.blockTimeMs', 'Use whole seconds of 1 or more.')
    if (network.fork) error('network.fork', 'Forking applies to local devnets only.')
    if ((network.gasLimit ?? 0) > 500_000_000) warn('network.gasLimit', 'Very large blocks raise node hardware and settlement data costs.')
  }

  if (economics.token === 'none' && economics.distribution.length) warn('economics.distribution', 'The distribution is ignored without a token.')
  if (economics.token !== 'none' && economics.token !== 'clanker') {
    const total = economics.distribution.reduce((sum, item) => sum + item.pct, 0)
    if (!economics.distribution.length) error('economics.distribution', 'Describe where the token supply goes.')
    else if (total !== 100) error('economics.distribution', `Allocations add up to ${total}%, not 100%.`)
    if (new Set(economics.distribution.map((item) => item.label.toLowerCase())).size !== economics.distribution.length) error('economics.distribution', 'Allocation labels must be unique.')
  }
  if (economics.token === 'clanker' && economics.distribution.length) error('economics.distribution', 'Clanker puts the whole supply in its pool; a custom distribution is not possible.')
  if (economics.feePolicy === 'sponsored' && !execution.accountAbstraction.includes('erc4337')) error('economics.feePolicy', 'Sponsored gas needs ERC-4337 (a paymaster).')

  if (execution.upgrades !== 'immutable' && security.admin === 'none') error('security.admin', 'Upgradeable contracts need someone allowed to upgrade them.')
  if (execution.upgrades !== 'immutable' && security.admin === 'eoa') warn('security.admin', 'One key can replace every contract. A multisig or timelock limits that.')
  if (security.governance === 'token-vote' && economics.token === 'none') error('security.governance', 'Token voting needs a token.')
  if (economics.treasury !== 'none' && security.admin === 'none' && security.governance === 'none') warn('economics.treasury', 'Nobody can move treasury funds without an admin or governance.')

  const smartAccount = execution.accountAbstraction.length > 0
  if (cryptography.rotation === 'smart-account' && !smartAccount) error('cryptography.rotation', 'Key rotation needs smart accounts (ERC-4337 or EIP-7702).')
  if (cryptography.auth !== 'ecdsa' && !smartAccount) error('cryptography.auth', 'Anything other than ECDSA needs smart accounts (ERC-4337 or EIP-7702).')
  if ((cryptography.auth === 'hybrid-mldsa' || cryptography.auth === 'mldsa') && execution.accountAbstraction.includes('eip7702')) {
    warn('cryptography.auth', 'An EIP-7702 account keeps its original ECDSA key, which can always override the delegation. It cannot be made post-quantum.')
  }
  if (cryptography.auth === 'passkey' && !execution.precompiles.includes('p256')) warn('execution.precompiles', 'Without the P-256 precompile, passkey checks run in Solidity and cost far more gas.')
  if (security.keys === 'smart-account' && !smartAccount) error('security.keys', 'Smart-account keys need ERC-4337 or EIP-7702.')
  if (dna.privacy.execution === 'public' && (dna.privacy.zkVerifier !== 'none' || dna.privacy.disclosure !== 'none')) {
    warn('privacy.execution', 'Proofs and commitments hide inputs, not activity: senders, timing, gas and calldata stay public.')
  }
  return issues
}

/* ---------- readiness ---------- */

export type ReadinessStatus = 'ready' | 'planned' | 'blocked' | 'research'

export interface ReadinessItem {
  id: string
  label: string
  status: ReadinessStatus
  detail: string
}

/** What Quantum Fork itself can do with this configuration today. Runtime facts (storage, registry) are added by the caller. */
export function readiness(dna: ChainDna): ReadinessItem[] {
  const issues = validateDna(dna)
  const errors = issues.filter((issue) => issue.level === 'error')
  const research = chosenOptions(dna).filter((item) => item.support === 'research')
  const contracts = chosenOptions(dna).filter((item) => item.support === 'contracts')
  const items: ReadinessItem[] = [
    { id: 'export', label: 'Export Chain DNA', status: errors.length ? 'blocked' : 'ready', detail: errors.length ? `Fix ${errors.length} compatibility error${errors.length === 1 ? '' : 's'} first.` : 'Download, share or compare this document.' },
  ]
  if (dna.target === 'local-devnet') {
    const nodeBlocked = research.some((item) => item.field.layer === 'execution-client' || item.field.layer === 'consensus')
    items.push({
      id: 'anvil',
      label: 'Run the devnet with Anvil',
      status: errors.length ? 'blocked' : nodeBlocked ? 'research' : 'ready',
      detail: nodeBlocked ? 'A chosen node feature has no implementation.' : 'Copy the generated command. It runs on your machine; Quantum Fork does not host it.',
    })
  }
  if (dna.target === 'op-stack') {
    items.push({ id: 'provision', label: 'Provision the rollup', status: 'blocked', detail: 'Needs OP Stack infrastructure Quantum Fork does not operate: an execution client, rollup node, batcher, proposer, and settlement contracts funded on the parent chain.' })
  }
  if (contracts.length) {
    items.push({
      id: 'contracts',
      label: `Deploy ${contracts.length} contract component${contracts.length === 1 ? '' : 's'}`,
      status: 'planned',
      detail: `${contracts.map((item) => item.option.label).join(', ')}. You deploy these yourself today; Quantum Fork does not generate or deploy contract suites yet.`,
    })
  }
  if (research.length) items.push({ id: 'research', label: `${research.length} research-only choice${research.length === 1 ? '' : 's'}`, status: 'research', detail: research.map((item) => item.option.label).join(', ') })
  return items
}

/** Processes someone has to run. Counts, not invented hardware numbers. */
export function infrastructure(dna: ChainDna): { component: string; operator: string }[] {
  if (dna.target === 'base') return [{ component: 'Base (sequencer, nodes, proofs)', operator: 'Base' }, { component: 'Your contracts', operator: 'You, deployed once' }, { component: 'An RPC endpoint', operator: 'Public endpoint or a provider' }]
  if (dna.target === 'local-devnet') {
    return [{ component: 'One Anvil process', operator: 'You, on your machine' }, ...(dna.network.fork ? [{ component: `RPC for ${dna.network.fork.source} state`, operator: 'Read lazily while you test' }] : [])]
  }
  return [
    { component: 'Execution client (op-geth or op-reth)', operator: 'Rollup operator' },
    { component: 'Rollup node (op-node)', operator: 'Rollup operator' },
    { component: 'Batcher (op-batcher), posts data and pays for it', operator: 'Rollup operator' },
    { component: 'Proposer (op-proposer), posts output roots', operator: 'Rollup operator' },
    { component: `Settlement contracts on ${dna.network.settlement}`, operator: 'Deployed once, funded on the parent chain' },
    ...(dna.security.sequencing === 'decentralized' ? [{ component: 'Several sequencers', operator: 'Research: no standard implementation' }] : []),
  ]
}

/* ---------- canonical form, hashes, sharing ---------- */

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** keccak256 of the whole canonical document. This is what the Base registry stores. */
export function dnaHash(dna: ChainDna): `0x${string}` {
  return keccak256(stringToBytes(`${DNA_SPEC}:${canonicalJson(dna)}`))
}

/** keccak256 of the technical properties only: renaming a configuration does not change its genome. */
export function technicalHash(dna: ChainDna): `0x${string}` {
  const { name: _name, description: _description, ...rest } = dna
  void _name
  void _description
  return keccak256(stringToBytes(`${DNA_SPEC}/technical:${canonicalJson(rest)}`))
}

export type ParseResult = { ok: true; dna: ChainDna } | { ok: false; issues: string[] }

export function parseDna(input: unknown): ParseResult {
  let raw = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch {
      return { ok: false, issues: ['Not valid JSON.'] }
    }
  }
  const parsed = chainDnaSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`) }
  return { ok: true, dna: parsed.data }
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export function encodeShare(dna: ChainDna) {
  return toBase64Url(new TextEncoder().encode(canonicalJson(dna)))
}

export function decodeShare(text: string): ParseResult {
  if (!/^[A-Za-z0-9_-]{1,8000}$/.test(text)) return { ok: false, issues: ['The share link is malformed.'] }
  try {
    return parseDna(new TextDecoder().decode(fromBase64Url(text)))
  } catch {
    return { ok: false, issues: ['The share link is malformed.'] }
  }
}

/* ---------- comparison ---------- */

export interface DnaDifference {
  path: string
  label: string
  left: string
  right: string
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length ? value.map((item) => (typeof item === 'object' ? `${(item as { label: string }).label} ${(item as { pct: number }).pct}%` : String(item))).join(', ') : 'none'
  if (typeof value === 'object') return canonicalJson(value)
  return String(value)
}

function leaves(value: unknown, prefix = ''): [string, unknown][] {
  if (value && typeof value === 'object' && !Array.isArray(value) && !(prefix === 'network.fork')) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key))
  }
  return [[prefix, value]]
}

const PATH_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  target: 'Target',
  'network.chainId': 'Chain ID',
  'network.fork': 'Fork source',
  'network.blockTimeMs': 'Block time (ms)',
  'network.gasLimit': 'Block gas limit',
  'economics.baseFeeGwei': 'Base fee (gwei)',
  'economics.distribution': 'Token distribution',
}

export function labelFor(path: string) {
  return FIELD_BY_PATH[path]?.label ?? PATH_LABELS[path] ?? path
}

export function diffDna(left: ChainDna, right: ChainDna): DnaDifference[] {
  const a = new Map(leaves(left))
  const b = new Map(leaves(right))
  const paths = [...new Set([...a.keys(), ...b.keys()])].filter((path) => path !== 'spec')
  return paths.filter((path) => canonicalJson(a.get(path)) !== canonicalJson(b.get(path))).map((path) => ({ path, label: labelFor(path), left: display(a.get(path)), right: display(b.get(path)) }))
}

/* ---------- Anvil ---------- */

export const FORK_RPC: Record<'base' | 'base-sepolia', string> = { base: 'https://mainnet.base.org', 'base-sepolia': 'https://sepolia.base.org' }

/** Anvil's OP Stack mode only accepts OP hardfork names: Isthmus carries Prague's rules, Fjord Cancun's. */
const OP_HARDFORK = { prague: 'isthmus', cancun: 'fjord' } as const

/** The Anvil arguments that realise a local-devnet configuration. Checked against Anvil 1.7 by tests/anvil.test.ts. */
export function anvilArgs(dna: ChainDna): string[] {
  if (dna.target !== 'local-devnet') return []
  const opStack = Boolean(dna.network.fork) || dna.execution.precompiles.includes('p256')
  const args = ['--chain-id', String(dna.network.chainId)]
  if (opStack) args.push('--network', 'optimism', '--hardfork', OP_HARDFORK[dna.execution.evm])
  else args.push('--hardfork', dna.execution.evm)
  if (dna.network.blockTimeMs > 0) args.push('--block-time', String(dna.network.blockTimeMs / 1000))
  if (dna.network.gasLimit) args.push('--gas-limit', String(dna.network.gasLimit))
  const gwei = dna.economics.feePolicy === 'zero-fee' ? 0 : (dna.economics.baseFeeGwei ?? 0)
  args.push('--base-fee', String(Math.round(gwei * 1e9)))
  if (dna.network.fork) {
    args.push('--fork-url', FORK_RPC[dna.network.fork.source])
    if (dna.network.fork.block) args.push('--fork-block-number', String(dna.network.fork.block))
  }
  return args
}

export function anvilCommand(dna: ChainDna) {
  return ['anvil', ...anvilArgs(dna)].join(' ')
}

/* ---------- registry ---------- */

/** QForkRegistry.Kind */
export const REGISTRY_KIND: Record<Target, number> = { base: 1, 'local-devnet': 2, 'op-stack': 3 }
