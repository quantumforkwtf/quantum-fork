import type { OrganPart } from '../lab/morphology.js'
import type { SourceId } from './sources.js'

export type FindingStatus =
  | 'REVIEWED'
  | 'EXPOSED'
  | 'MIGRATION AVAILABLE'
  | 'EXTERNAL DEPENDENCY'
  | 'NOT APPLICABLE'
  | 'EXPERIMENTAL'
  | 'UNKNOWN'

export const FINDING_STATUSES: { status: FindingStatus; meaning: string }[] = [
  { status: 'EXPOSED', meaning: 'Relies on a primitive that a cryptographically relevant quantum computer is expected to break (Shor).' },
  { status: 'EXTERNAL DEPENDENCY', meaning: 'Controlled by software or operators outside the chain protocol. A descendant cannot fix it alone.' },
  { status: 'EXPERIMENTAL', meaning: 'A post-quantum option exists but is still prototype code.' },
  { status: 'MIGRATION AVAILABLE', meaning: 'A standardized, maintained alternative exists and can be adopted without new research.' },
  { status: 'REVIEWED', meaning: 'Reviewed and not considered a primary quantum exposure under current assumptions.' },
  { status: 'UNKNOWN', meaning: 'Current deployment state could not be confirmed from public sources.' },
  { status: 'NOT APPLICABLE', meaning: 'The category does not apply to this ancestor.' },
]

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'

export type CategoryCode = 'SIG' | 'KEY' | 'HSH' | 'TXA' | 'VAL' | 'WLT' | 'BRG' | 'RCV' | 'PRF' | 'EXT'

export interface ExposureFinding {
  id: string
  category: CategoryCode
  primitive: string
  implementation: string
  relevance: string
  migrationStatus: string
  alternative: string
  compatibility: string
  confidence: Confidence
  sources: SourceId[]
  status: FindingStatus
}

export interface GenomeLocus {
  code: CategoryCode
  name: string
  category: string
  part: OrganPart
  why: string
  current: string
  consideration: string
  migration: string
  impact: string
  sources: SourceId[]
}

export type AncestorStatus = 'AVAILABLE' | 'NOT YET SEQUENCED'

export interface Ancestor {
  id: string
  code: string
  name: string
  status: AncestorStatus
  scope?: string
  model?: AnalysisModel
  /** Descendants can be designed in the Lab. Otherwise the ancestor is scan-only. */
  lab?: boolean
}

export interface AnalysisModel {
  id: string
  version: string
  kind: string
  compiled: string
  disclaimer: string
}

export const SOLANA_MODEL: AnalysisModel = {
  id: 'qf-exposure-solana',
  version: '0.1.0',
  kind: 'Hand-built model',
  compiled: '2026-10-15',
  disclaimer: 'Compiled by hand from the public sources cited on each finding. It is not an automated scan of Agave or Firedancer source code.',
}

export const BASE_MODEL: AnalysisModel = {
  id: 'qf-exposure-base',
  version: '0.1.0',
  kind: 'Hand-built model',
  compiled: '2026-10-25',
  disclaimer: 'Compiled by hand from the public sources cited on each finding, covering Base mainnet after the Azul and Cobalt upgrades. It is not an automated scan of base-reth-node or the Base contracts.',
}

export const ANCESTORS: Ancestor[] = [
  { id: 'base', code: 'ANCESTOR 001', name: 'BASE', status: 'AVAILABLE', scope: 'Base mainnet after Azul and Cobalt, settling on Ethereum', model: BASE_MODEL, lab: true },
  { id: 'solana', code: 'ANCESTOR 002', name: 'SOLANA', status: 'AVAILABLE', scope: 'Solana mainnet-beta protocol as implemented by Agave', model: SOLANA_MODEL, lab: true },
  { id: 'ethereum', code: 'ANCESTOR 003', name: 'ETHEREUM', status: 'NOT YET SEQUENCED' },
  { id: 'cosmos', code: 'ANCESTOR 004', name: 'COSMOS', status: 'NOT YET SEQUENCED' },
  { id: 'bitcoin', code: 'ANCESTOR 005', name: 'BITCOIN', status: 'NOT YET SEQUENCED' },
  { id: 'sui', code: 'ANCESTOR 006', name: 'SUI', status: 'NOT YET SEQUENCED' },
]

export const SOLANA_LOCI: GenomeLocus[] = [
  {
    code: 'SIG',
    name: 'Signature architecture',
    category: 'SIGNATURES',
    part: 'signature',
    why: 'Signatures are the only thing that proves an owner authorized a transfer. If they can be forged, ownership is meaningless.',
    current: 'Ed25519 (EdDSA over Curve25519, RFC 8032). 64-byte signatures, 32-byte public keys.',
    consideration: "Ed25519 security rests on the elliptic-curve discrete logarithm problem, which Shor's algorithm solves on a large enough quantum computer.",
    migration: 'Hybrid Ed25519 + a NIST post-quantum signature. ML-DSA (FIPS 204) is final; FN-DSA / Falcon (FIPS 206) is the compact candidate both Solana client teams favour but is not yet a final standard.',
    impact: 'Breaking. Post-quantum signatures are 10–70× larger than Ed25519 and exceed the 1,232-byte transaction limit unless the format changes.',
    sources: ['rfc-8032', 'shor-1994', 'fips-204', 'fips-206', 'solana-quantum'],
  },
  {
    code: 'KEY',
    name: 'Key architecture',
    category: 'KEY ARCHITECTURE',
    part: 'keys',
    why: 'How addresses relate to keys decides how long a public key sits exposed and whether an account can ever change its key.',
    current: 'An account address is the raw 32-byte Ed25519 public key. It is visible from the first time the address receives funds. System accounts cannot rotate keys.',
    consideration: 'Every funded address publishes the input a quantum attacker needs. Because the address is the key, moving to a new scheme means moving to a new address.',
    migration: 'A key-set descriptor: address = hash(suite identifier, public keys), with protocol-level rotation. Program-derived addresses already have no private key.',
    impact: 'Breaking for every wallet and indexer. Existing balances must move to new addresses through a migration window.',
    sources: ['solana-accounts', 'solana-pda', 'anagram-pq'],
  },
  {
    code: 'HSH',
    name: 'Hashing',
    category: 'HASH FUNCTIONS',
    part: 'hash',
    why: 'Hashes chain blocks together, commit to state and derive addresses. They are also the basis of most conservative post-quantum designs.',
    current: 'SHA-256 for Proof of History and blockhashes, Blake3 for account-state hashing, plus SHA-256, Keccak-256, Blake3 and Poseidon syscalls for programs.',
    consideration: "Grover's algorithm gives at most a quadratic speed-up on preimage search. 256-bit hashes keep a large margin and are not considered a primary exposure.",
    migration: 'No migration required. SHA-3 / SHAKE (FIPS 202) are available for crypto-agility and hash-based signatures.',
    impact: 'None for the hash functions themselves.',
    sources: ['grover-1996', 'nist-pqc'],
  },
  {
    code: 'TXA',
    name: 'Transaction authorization',
    category: 'TRANSACTION AUTHORIZATION',
    part: 'execution',
    why: 'This is the runtime path that decides whether a transaction is allowed to touch an account.',
    current: 'Every required signer attaches an Ed25519 signature verified in the sigverify stage. Precompiles verify Ed25519, secp256k1 and secp256r1 signatures for programs.',
    consideration: 'All three verification paths use elliptic curves. Larger post-quantum signatures also change bandwidth, fee and sigverify throughput assumptions.',
    migration: 'A new transaction version carrying suite-tagged signatures, plus on-chain verification of post-quantum signatures. Falcon-512 verification already runs inside SBF programs as research code.',
    impact: 'High. Requires a transaction format change. SIMD-0296 proposes raising the limit from 1,232 to 4,096 bytes; even then ML-DSA-65 does not fit a typical transaction.',
    sources: ['solana-transactions', 'simd-0296', 'blueshift-falcon', 'anagram-pq'],
  },
  {
    code: 'VAL',
    name: 'Validator identity',
    category: 'VALIDATOR IDENTITY',
    part: 'consensus',
    why: 'Validators sign blocks, votes and gossip. Forged validator signatures attack consensus itself, not one account.',
    current: 'Ed25519 identity and vote-authority keys sign shreds, gossip and votes. Alpenglow (SIMD-0326) moves votes to BLS12-381 aggregate certificates, scheduled to activate on mainnet in epoch 1064 (21 October 2026).',
    consideration: 'Both Ed25519 and BLS12-381 are elliptic-curve schemes. Post-quantum signatures do not aggregate the way BLS does, which is an open research problem for certificate-based consensus.',
    migration: 'No standardized post-quantum aggregate signature exists. Options include hybrid identity keys and per-validator post-quantum attestations, at a bandwidth cost.',
    impact: 'Very high. Consensus-critical and performance-critical.',
    sources: ['simd-0326', 'simd-0387', 'solana-alpenglow', 'anagram-pq'],
  },
  {
    code: 'WLT',
    name: 'Wallet dependencies',
    category: 'WALLET DEPENDENCIES',
    part: 'keys',
    why: 'Users never touch protocol keys directly. Wallets generate, store and use them, so wallets decide how fast a migration can happen.',
    current: 'BIP-39 mnemonics with SLIP-0010 Ed25519 derivation. Browser, mobile and hardware wallets sign Ed25519 through the Wallet Standard.',
    consideration: 'Mnemonic stretching is hash-based, but every key derived from it is Ed25519. Hardware wallets have tight memory limits for large post-quantum keys.',
    migration: 'Wallets must add post-quantum key generation, signing and the new address format. Agave has a research proof of concept that includes hardware-wallet signing flows.',
    impact: 'Ecosystem-wide. Outside the control of any single chain.',
    sources: ['bip-39', 'slip-0010', 'wallet-standard', 'anagram-pq'],
  },
  {
    code: 'BRG',
    name: 'Bridge dependencies',
    category: 'BRIDGE DEPENDENCIES',
    part: 'modules',
    why: 'Assets bridged into a chain are only as safe as the signatures the bridge relies on.',
    current: 'Major bridges attest messages with classical signatures. Wormhole guardians sign with secp256k1, verified on Solana through the secp256k1 precompile.',
    consideration: 'A forged bridge attestation can mint unbacked assets regardless of how the destination chain itself is secured.',
    migration: 'Requires bridge operators to adopt post-quantum attestations on both chains. A descendant can refuse classical-only bridges but cannot upgrade them.',
    impact: 'External. Bridged assets inherit the weakest link.',
    sources: ['wormhole'],
  },
  {
    code: 'RCV',
    name: 'Recovery architecture',
    category: 'RECOVERY',
    part: 'recovery',
    why: 'Migration needs owners to act. Dormant or lost-key accounts cannot migrate, and a quantum attacker can race an owner who migrates late.',
    current: 'No protocol-level recovery or key rotation. Program-level patterns such as multisigs and upgrade authorities rely on Ed25519 signers.',
    consideration: 'If migration requires signing with the old key, whoever can forge that key can also migrate the account first.',
    migration: 'Pre-committed post-quantum recovery: commit to the hash of a post-quantum key today, reveal it during migration. Hash-based one-time signature vaults exist as opt-in programs.',
    impact: 'Medium. Opt-in vaults work today but cannot pay fees or protect ordinary accounts.',
    sources: ['blueshift-pq', 'fips-205', 'solana-quantum'],
  },
  {
    code: 'PRF',
    name: 'Proof systems',
    category: 'PROOF SYSTEMS',
    part: 'proof',
    why: 'Zero-knowledge proofs secure privacy features and some scaling systems. They can fail in two ways: forged proofs, and encrypted data revealed later.',
    current: 'The ZK ElGamal proof program (confidential transfers) uses twisted ElGamal over Curve25519; it was re-enabled on mainnet in June 2026. alt_bn128 syscalls verify pairing-based proofs such as Groth16.',
    consideration: 'Discrete-log and pairing assumptions fall to Shor. Encrypted balances recorded today could be decrypted later (harvest now, decrypt later).',
    migration: 'Hash-based or lattice-based proof systems. None is standardized for this use.',
    impact: 'High for privacy. Past confidentiality cannot be restored retroactively.',
    sources: ['token-2022-status', 'shor-1994'],
  },
  {
    code: 'EXT',
    name: 'External cryptography',
    category: 'EXTERNAL CRYPTOGRAPHIC DEPENDENCIES',
    part: 'privacy',
    why: 'Networks also depend on transport encryption, RPC providers, oracles and the web PKI.',
    current: 'Validator transport uses QUIC with TLS 1.3 and certificates bound to Ed25519 identity keys. RPC endpoints are HTTPS. Oracles sign with classical keys.',
    consideration: 'Key exchange (X25519) is exposed to harvest-now-decrypt-later, though most chain data is public anyway. Authentication still relies on classical certificates.',
    migration: 'Hybrid X25519 + ML-KEM-768 key exchange (FIPS 203) is available in maintained TLS libraries. Whether Solana clients enable it could not be confirmed.',
    impact: 'Low to medium, depending on the operator.',
    sources: ['rustls', 'tls-mlkem', 'fips-203'],
  },
]

export const SOLANA_FINDINGS: ExposureFinding[] = [
  {
    id: 'SOL-SIG-01',
    category: 'SIG',
    primitive: 'Ed25519',
    implementation: 'Transaction and message signatures; ed25519 crates in Agave, native implementation in Firedancer',
    relevance: 'Shor: private key recoverable from public key',
    migrationStatus: 'No protocol-level post-quantum signature on mainnet',
    alternative: 'ML-DSA (FIPS 204); FN-DSA / Falcon (FIPS 206, draft)',
    compatibility: 'Breaking: signature size and transaction format',
    confidence: 'HIGH',
    sources: ['rfc-8032', 'shor-1994', 'agave', 'firedancer'],
    status: 'EXPOSED',
  },
  {
    id: 'SOL-KEY-01',
    category: 'KEY',
    primitive: 'Ed25519 public key as address',
    implementation: 'Account model: address is the 32-byte public key',
    relevance: 'Public key exposed from first deposit, not first spend',
    migrationStatus: 'No key rotation for system accounts',
    alternative: 'Hash-committed key-set addresses with rotation',
    compatibility: 'Breaking: addresses change',
    confidence: 'HIGH',
    sources: ['solana-accounts'],
    status: 'EXPOSED',
  },
  {
    id: 'SOL-KEY-02',
    category: 'KEY',
    primitive: 'Program-derived addresses',
    implementation: 'Off-curve addresses derived with SHA-256; no private key exists',
    relevance: 'No key to recover; authority flows from program logic and its signers',
    migrationStatus: 'Inherits the exposure of whichever keys control the program',
    alternative: 'Not required for the address itself',
    compatibility: 'None',
    confidence: 'HIGH',
    sources: ['solana-pda'],
    status: 'REVIEWED',
  },
  {
    id: 'SOL-HSH-01',
    category: 'HSH',
    primitive: 'SHA-256, Blake3, Keccak-256',
    implementation: 'Proof of History, blockhashes, account hashing, program syscalls',
    relevance: 'Grover: at most quadratic speed-up on preimage search',
    migrationStatus: 'Not required at 256-bit output',
    alternative: 'SHA-3 / SHAKE (FIPS 202) for agility',
    compatibility: 'None',
    confidence: 'HIGH',
    sources: ['grover-1996', 'nist-pqc'],
    status: 'REVIEWED',
  },
  {
    id: 'SOL-TXA-01',
    category: 'TXA',
    primitive: 'Ed25519 sigverify',
    implementation: 'Runtime sigverify stage for every required signer',
    relevance: 'Authorization for every account write',
    migrationStatus: 'Research only (Agave ML-DSA proof of concept)',
    alternative: 'Suite-tagged signatures in a new transaction version',
    compatibility: 'Breaking; bandwidth and fee model change',
    confidence: 'HIGH',
    sources: ['solana-transactions', 'anagram-pq'],
    status: 'EXPOSED',
  },
  {
    id: 'SOL-TXA-02',
    category: 'TXA',
    primitive: 'Transaction size limit: 1,232 bytes',
    implementation: 'Packet-size constraint on serialized transactions',
    relevance: 'One ML-DSA-44 signature is 2,420 bytes and does not fit',
    migrationStatus: 'SIMD-0296 proposes 4,096 bytes',
    alternative: 'Larger transactions plus compact schemes (Falcon-512 ≈ 666-byte signatures)',
    compatibility: 'Breaking for transaction parsers',
    confidence: 'HIGH',
    sources: ['solana-transactions', 'simd-0296', 'fips-204'],
    status: 'EXPOSED',
  },
  {
    id: 'SOL-TXA-03',
    category: 'TXA',
    primitive: 'Falcon-512 verification in SBF programs',
    implementation: 'Open-source program-level verifier; no protocol change',
    relevance: 'Lets programs check post-quantum signatures today',
    migrationStatus: 'Research code; SIMD-0461 syscall closed pending demand',
    alternative: 'Native verification via syscall or precompile',
    compatibility: 'Opt-in per program',
    confidence: 'MEDIUM',
    sources: ['blueshift-falcon', 'simd-0461'],
    status: 'EXPERIMENTAL',
  },
  {
    id: 'SOL-VAL-01',
    category: 'VAL',
    primitive: 'Ed25519 identity and vote keys',
    implementation: 'Shred signing, gossip, vote authority',
    relevance: 'Forged leader or vote signatures attack consensus',
    migrationStatus: 'Research only',
    alternative: 'Hybrid identity keys with post-quantum attestations',
    compatibility: 'Consensus-breaking change',
    confidence: 'HIGH',
    sources: ['agave', 'anagram-pq'],
    status: 'EXPOSED',
  },
  {
    id: 'SOL-VAL-02',
    category: 'VAL',
    primitive: 'BLS12-381 aggregate signatures (Alpenglow)',
    implementation: 'Vote certificates under SIMD-0326; BLS keys registered since July 2026',
    relevance: 'Pairing-based; also broken by Shor',
    migrationStatus: 'No standardized post-quantum aggregate signature',
    alternative: 'Open research problem',
    compatibility: 'Consensus-breaking change',
    confidence: 'MEDIUM',
    sources: ['simd-0326', 'simd-0387', 'solana-alpenglow'],
    status: 'EXPOSED',
  },
  {
    id: 'SOL-WLT-01',
    category: 'WLT',
    primitive: 'SLIP-0010 Ed25519 derivation',
    implementation: 'Browser, mobile and hardware wallets',
    relevance: 'Every derived key is Ed25519',
    migrationStatus: 'Depends on wallet vendors',
    alternative: 'Post-quantum key generation and signing in wallets',
    compatibility: 'Ecosystem-wide',
    confidence: 'HIGH',
    sources: ['slip-0010', 'wallet-standard'],
    status: 'EXTERNAL DEPENDENCY',
  },
  {
    id: 'SOL-WLT-02',
    category: 'WLT',
    primitive: 'BIP-39 mnemonic (PBKDF2-HMAC-SHA512)',
    implementation: 'Seed generation and stretching',
    relevance: 'Hash-based; not a primary exposure',
    migrationStatus: 'Not required',
    alternative: 'Not required',
    compatibility: 'None',
    confidence: 'MEDIUM',
    sources: ['bip-39'],
    status: 'REVIEWED',
  },
  {
    id: 'SOL-BRG-01',
    category: 'BRG',
    primitive: 'secp256k1 ECDSA guardian signatures',
    implementation: 'Wormhole guardian attestations, verified via the secp256k1 precompile',
    relevance: 'Forged attestations can mint unbacked assets',
    migrationStatus: 'Controlled by the bridge operator',
    alternative: 'Post-quantum attestations on both chains',
    compatibility: 'External',
    confidence: 'HIGH',
    sources: ['wormhole'],
    status: 'EXTERNAL DEPENDENCY',
  },
  {
    id: 'SOL-RCV-01',
    category: 'RCV',
    primitive: 'No protocol-level recovery',
    implementation: 'Owners must sign with the existing Ed25519 key to move funds',
    relevance: 'Late migrators can be raced by an attacker',
    migrationStatus: 'Opt-in vaults only',
    alternative: 'Pre-committed post-quantum recovery keys (hash commitment)',
    compatibility: 'Requires a migration window',
    confidence: 'MEDIUM',
    sources: ['solana-quantum', 'anagram-pq'],
    status: 'EXPOSED',
  },
  {
    id: 'SOL-RCV-02',
    category: 'RCV',
    primitive: 'Winternitz one-time signatures (vault program)',
    implementation: 'Blueshift Winternitz Vault / Winterwallet on mainnet',
    relevance: 'Hash-based custody that does not rely on elliptic curves',
    migrationStatus: 'Live on mainnet; cannot pay fees',
    alternative: 'Protocol-level post-quantum accounts',
    compatibility: 'Opt-in; fee payer still signs with Ed25519',
    confidence: 'MEDIUM',
    sources: ['blueshift-pq'],
    status: 'EXPERIMENTAL',
  },
  {
    id: 'SOL-PRF-01',
    category: 'PRF',
    primitive: 'Twisted ElGamal and sigma proofs on Curve25519',
    implementation: 'ZK ElGamal proof program for Token-2022 confidential transfers',
    relevance: 'Forgeable proofs and decryptable balances under Shor',
    migrationStatus: 'Re-enabled on mainnet June 2026; no post-quantum variant',
    alternative: 'Hash-based or lattice-based proofs (unstandardized)',
    compatibility: 'High for privacy features',
    confidence: 'HIGH',
    sources: ['token-2022-status'],
    status: 'EXPOSED',
  },
  {
    id: 'SOL-PRF-02',
    category: 'PRF',
    primitive: 'alt_bn128 pairings',
    implementation: 'Syscalls used to verify Groth16 and similar proofs',
    relevance: 'Pairing-based; broken by Shor',
    migrationStatus: 'Application-level',
    alternative: 'STARK-style hash-based proofs',
    compatibility: 'Per application',
    confidence: 'MEDIUM',
    sources: ['agave'],
    status: 'EXPOSED',
  },
  {
    id: 'SOL-EXT-01',
    category: 'EXT',
    primitive: 'TLS 1.3 key exchange (X25519)',
    implementation: 'QUIC transport between validators; HTTPS to RPC providers',
    relevance: 'Harvest now, decrypt later on transport traffic',
    migrationStatus: 'Hybrid ML-KEM supported upstream; Solana client adoption unconfirmed',
    alternative: 'X25519 + ML-KEM-768 (FIPS 203)',
    compatibility: 'Low; negotiated per connection',
    confidence: 'LOW',
    sources: ['rustls', 'tls-mlkem', 'fips-203'],
    status: 'UNKNOWN',
  },
  {
    id: 'SOL-EXT-02',
    category: 'EXT',
    primitive: 'Oracle and RPC provider signatures',
    implementation: 'Third-party price feeds and infrastructure',
    relevance: 'Classical signatures outside protocol control',
    migrationStatus: 'Controlled by providers',
    alternative: 'Provider-side post-quantum signatures',
    compatibility: 'External',
    confidence: 'MEDIUM',
    sources: ['nist-ir-8547'],
    status: 'EXTERNAL DEPENDENCY',
  },
]

export const BASE_LOCI: GenomeLocus[] = [
  {
    code: 'SIG',
    name: 'Signature architecture',
    category: 'SIGNATURES',
    part: 'signature',
    why: 'Signatures are the only thing that proves an owner authorized a transfer. If they can be forged, ownership is meaningless.',
    current: 'secp256k1 ECDSA for every externally owned account, as on Ethereum. Passkey smart wallets also sign with P-256 (secp256r1), verified by the P256VERIFY precompile since the Fjord upgrade (July 2024).',
    consideration: "Both secp256k1 and P-256 rest on the elliptic-curve discrete logarithm problem, which Shor's algorithm solves on a large enough quantum computer.",
    migration: 'No post-quantum signature is available on Base mainnet. Ethereum’s roadmap adds post-quantum signature precompiles in a later fork (J*); Base has not announced when it will adopt them.',
    impact: 'Breaking for every wallet. Post-quantum signatures are far larger than 65-byte ECDSA signatures and raise calldata cost on a rollup.',
    sources: ['eth-accounts', 'shor-1994', 'base-fjord', 'base-precompiles', 'eth-pq-roadmap'],
  },
  {
    code: 'KEY',
    name: 'Key architecture',
    category: 'KEY ARCHITECTURE',
    part: 'keys',
    why: 'How addresses relate to keys decides how long a public key sits exposed and whether an account can ever change its key.',
    current: 'An EOA address is the last 20 bytes of keccak256(public key). The public key is only revealed by the first outgoing transaction. EOAs cannot rotate keys; EIP-7702 (Isthmus, May 2025) lets an EOA delegate to code, but the original key keeps full control.',
    consideration: 'Addresses that have never sent a transaction hide their key behind a hash. Every address that has sent one has published the input a quantum attacker needs.',
    migration: 'Smart-contract accounts can check any signature scheme in contract code. Native account abstraction (EIP-8130) adds key rotation and pluggable authenticators, but only on a devnet so far.',
    impact: 'Breaking for EOAs. Funds in used EOAs must move to accounts that can authenticate with a post-quantum key.',
    sources: ['eth-accounts', 'eip-7702', 'base-isthmus', 'base-8130'],
  },
  {
    code: 'HSH',
    name: 'Hashing',
    category: 'HASH FUNCTIONS',
    part: 'hash',
    why: 'Hashes chain blocks together, commit to state and derive addresses. They are also the basis of most conservative post-quantum designs.',
    current: 'Keccak-256 for addresses, state tries, transaction and block hashes. SHA-256 and RIPEMD-160 precompiles are available to contracts.',
    consideration: "Grover's algorithm gives at most a quadratic speed-up on preimage search. 256-bit hashes keep a large margin and are not considered a primary exposure.",
    migration: 'No migration required. Keccak-256 is also the hash Ethereum’s hash-based post-quantum signature work builds on.',
    impact: 'None for the hash functions themselves.',
    sources: ['grover-1996', 'eth-accounts'],
  },
  {
    code: 'TXA',
    name: 'Transaction authorization',
    category: 'TRANSACTION AUTHORIZATION',
    part: 'execution',
    why: 'This is the runtime path that decides whether a transaction is allowed to touch an account.',
    current: 'The sender of every transaction is recovered from its secp256k1 signature. Contracts can verify secp256k1 (ecrecover) and P-256 (P256VERIFY) signatures.',
    consideration: 'Every native verification path uses elliptic curves. A post-quantum verifier written in contract code works today but is expensive and must be paid by an ECDSA-signed transaction.',
    migration: 'Base follows Ethereum’s execution layer. Native post-quantum transactions depend on Ethereum shipping post-quantum precompiles and transaction types, and on Base adopting them.',
    impact: 'High. Requires a new transaction type or account abstraction for every user.',
    sources: ['eth-accounts', 'base-precompiles', 'eth-pq-roadmap'],
  },
  {
    code: 'VAL',
    name: 'Sequencer and settlement',
    category: 'BLOCK PRODUCTION',
    part: 'consensus',
    why: 'Base has no validator set of its own. Blocks come from one sequencer, and safety comes from Ethereum, where batches are posted and checkpoints are proven.',
    current: 'A single Coinbase-operated sequencer orders transactions. Blocks it gossips before they reach Ethereum are signed with a secp256k1 sequencer key. Batches are then posted to Ethereum, whose validators sign with BLS12-381.',
    consideration: 'A forged sequencer signature can push fake pre-confirmed blocks to nodes; they are reorganized out once Ethereum data disagrees. Ethereum’s own BLS validator signatures are broken by Shor too.',
    migration: 'The sequencer key is operated by Coinbase. The Ethereum Foundation targets post-quantum consensus by December 2029, to be reassessed in January 2027.',
    impact: 'Medium for pre-confirmations, very high for settlement. Both depend on parties outside a descendant’s control.',
    sources: ['base-p2p', 'l2beat-base', 'ef-protocol-2026', 'eth-pq'],
  },
  {
    code: 'WLT',
    name: 'Wallet dependencies',
    category: 'WALLET DEPENDENCIES',
    part: 'keys',
    why: 'Users never touch protocol keys directly. Wallets generate, store and use them, so wallets decide how fast a migration can happen.',
    current: 'BIP-39 mnemonics with BIP-32 secp256k1 derivation. Browser wallets sign through injected providers (EIP-1193, discovered with EIP-6963). Coinbase Smart Wallet owners are Ethereum addresses or passkey P-256 keys.',
    consideration: 'Mnemonic stretching is hash-based, but every key derived from it is secp256k1. Passkeys are P-256. Neither has a post-quantum owner type today.',
    migration: 'Wallets must add post-quantum key generation and signing. Coinbase says it is building a post-quantum version of its custody key-management system.',
    impact: 'Ecosystem-wide. Outside the control of any single chain.',
    sources: ['bip-39', 'bip-32', 'eip-6963', 'coinbase-smart-wallet', 'coinbase-pq'],
  },
  {
    code: 'BRG',
    name: 'Bridge and withdrawals',
    category: 'BRIDGE DEPENDENCIES',
    part: 'modules',
    why: 'Most assets on Base arrive through its canonical bridge from Ethereum. Withdrawals back are only as safe as the proofs and upgrade keys behind that bridge.',
    current: 'Withdrawals are released against checkpoints proven by the Azul proof system. Bridge contract upgrades need a 2-of-2 multisig: Coinbase signers (3-of-6) and an 8-of-11 Security Council, both on Safe multisigs whose signers use secp256k1.',
    consideration: 'Anyone who can forge enough multisig signatures, or a proof the bridge accepts, can upgrade or drain the bridge regardless of user keys.',
    migration: 'Requires post-quantum signers for the upgrade multisigs and a post-quantum proof path. Neither has been announced.',
    impact: 'Very high. Bridged assets inherit the weakest link.',
    sources: ['base-security-council', 'base-azul-proofs'],
  },
  {
    code: 'RCV',
    name: 'Recovery architecture',
    category: 'RECOVERY',
    part: 'recovery',
    why: 'Migration needs owners to act. Dormant or lost-key accounts cannot migrate, and a quantum attacker can race an owner who migrates late.',
    current: 'No protocol-level recovery or key rotation for EOAs. Smart accounts can add and remove owners, but every owner type available today is elliptic-curve.',
    consideration: 'If migration requires signing with the old key, whoever can forge that key can also migrate the account first.',
    migration: 'An Ethereum research proposal describes an emergency hard fork that lets owners prove knowledge of their seed with a STARK. It is a proposal, not a plan Base has adopted.',
    impact: 'Medium. Smart accounts can rotate owners; EOAs cannot.',
    sources: ['eth-quantum-emergency', 'coinbase-smart-wallet', 'eth-accounts'],
  },
  {
    code: 'PRF',
    name: 'Proof systems',
    category: 'PROOF SYSTEMS',
    part: 'proof',
    why: 'Base’s withdrawals are secured by proofs posted to Ethereum, and its data is committed to Ethereum with KZG. If either can be forged, invalid state can settle.',
    current: 'Since Azul (May 2026): TEE proofs signed by AWS Nitro enclaves (secp256k1 signer keys, attested with P-384 certificates), backed by permissionless SP1 ZK proofs wrapped in Groth16 or PLONK over BN254. Batch data is posted as EIP-4844 blobs with KZG commitments over BLS12-381.',
    consideration: 'P-384, secp256k1, BN254 and BLS12-381 are all elliptic-curve or pairing based and fall to Shor. The STARK inside SP1 is hash-based, but the on-chain wrapper is not.',
    migration: 'Verifying the STARK directly on Ethereum, or a post-quantum attestation path. Ethereum plans post-quantum blob commitments in a later fork (M*).',
    impact: 'Very high. These proofs decide which withdrawals are paid.',
    sources: ['base-azul-proofs', 'base-proof-contracts', 'sp1-verification', 'eip-4844', 'eth-pq-roadmap'],
  },
  {
    code: 'EXT',
    name: 'External cryptography',
    category: 'EXTERNAL CRYPTOGRAPHIC DEPENDENCIES',
    part: 'privacy',
    why: 'Networks also depend on transport encryption, RPC providers, oracles and the web PKI.',
    current: 'Node networking uses secp256k1 identities (discv5, libp2p). RPC endpoints are HTTPS. Oracles sign with classical keys.',
    consideration: 'Key exchange is exposed to harvest-now-decrypt-later, though most chain data is public anyway. Authentication still relies on classical certificates.',
    migration: 'Hybrid X25519 + ML-KEM-768 key exchange (FIPS 203) is available in maintained TLS stacks. A third-party scorecard reports it at Base’s public RPC edge; not verified here.',
    impact: 'Low to medium, depending on the operator.',
    sources: ['base-p2p', 'tls-mlkem', 'fips-203', 'layerqu-base'],
  },
]

export const BASE_FINDINGS: ExposureFinding[] = [
  {
    id: 'BASE-SIG-01',
    category: 'SIG',
    primitive: 'secp256k1 ECDSA',
    implementation: 'Signatures on every EOA transaction',
    relevance: 'Shor: private key recoverable from public key',
    migrationStatus: 'No post-quantum signature on Base mainnet',
    alternative: 'ML-DSA (FIPS 204) or hash-based signatures via account abstraction',
    compatibility: 'Breaking: signature size and account type',
    confidence: 'HIGH',
    sources: ['eth-accounts', 'shor-1994', 'eth-pq'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-SIG-02',
    category: 'SIG',
    primitive: 'P-256 (secp256r1) passkeys',
    implementation: 'P256VERIFY precompile (RIP-7212, Fjord, July 2024); Coinbase Smart Wallet passkey owners',
    relevance: 'Elliptic curve; also broken by Shor',
    migrationStatus: 'No post-quantum passkey standard',
    alternative: 'Post-quantum owner keys in smart accounts',
    compatibility: 'Opt-in per wallet',
    confidence: 'HIGH',
    sources: ['base-fjord', 'base-precompiles', 'coinbase-smart-wallet'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-KEY-01',
    category: 'KEY',
    primitive: 'keccak256(public key) addresses',
    implementation: 'EOA address is the last 20 bytes of the public key hash',
    relevance: 'Key hidden until the first outgoing transaction, then exposed for good',
    migrationStatus: 'No key rotation for EOAs',
    alternative: 'Smart accounts that rotate to a post-quantum key',
    compatibility: 'Breaking: funds move to a new account type',
    confidence: 'HIGH',
    sources: ['eth-accounts'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-KEY-02',
    category: 'KEY',
    primitive: 'EIP-7702 delegation',
    implementation: 'EOAs can point at contract code (Isthmus, May 2025)',
    relevance: 'Delegation adds logic but the original ECDSA key keeps full control',
    migrationStatus: 'Live; does not remove the classical key',
    alternative: 'A key-revocation step once post-quantum authentication exists',
    compatibility: 'Opt-in per account',
    confidence: 'HIGH',
    sources: ['eip-7702', 'base-isthmus'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-KEY-03',
    category: 'KEY',
    primitive: 'Native account abstraction (EIP-8130)',
    implementation: 'Pluggable authenticators and key rotation in a system contract',
    relevance: 'Would let accounts switch to post-quantum authentication without moving funds',
    migrationStatus: 'Devnet only (vibenet); no post-quantum authenticator in the canonical set',
    alternative: 'Same design on mainnet with a post-quantum authenticator',
    compatibility: 'New transaction type',
    confidence: 'MEDIUM',
    sources: ['base-8130', 'layerqu-base'],
    status: 'EXPERIMENTAL',
  },
  {
    id: 'BASE-HSH-01',
    category: 'HSH',
    primitive: 'Keccak-256, SHA-256',
    implementation: 'Addresses, state tries, transaction and block hashes, precompiles',
    relevance: 'Grover: at most quadratic speed-up on preimage search',
    migrationStatus: 'Not required at 256-bit output',
    alternative: 'Not required',
    compatibility: 'None',
    confidence: 'HIGH',
    sources: ['grover-1996', 'eth-accounts'],
    status: 'REVIEWED',
  },
  {
    id: 'BASE-TXA-01',
    category: 'TXA',
    primitive: 'Sender recovery from ECDSA',
    implementation: 'Every transaction’s sender is recovered from its secp256k1 signature',
    relevance: 'Authorization for every account write',
    migrationStatus: 'Depends on Ethereum’s post-quantum precompiles (J*) and Base adopting them',
    alternative: 'Post-quantum transaction type or account abstraction',
    compatibility: 'Breaking; calldata cost rises',
    confidence: 'HIGH',
    sources: ['eth-accounts', 'eth-pq-roadmap'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-TXA-02',
    category: 'TXA',
    primitive: 'Post-quantum verifiers in contract code',
    implementation: 'Smart accounts can verify any scheme in Solidity',
    relevance: 'Works today without a protocol change',
    migrationStatus: 'No widely deployed post-quantum verifier; gas cost high',
    alternative: 'Native precompile',
    compatibility: 'Opt-in; the transaction itself is still ECDSA-signed',
    confidence: 'MEDIUM',
    sources: ['eth-pq'],
    status: 'EXPERIMENTAL',
  },
  {
    id: 'BASE-VAL-01',
    category: 'VAL',
    primitive: 'secp256k1 sequencer block signatures',
    implementation: 'Unsafe blocks gossiped over P2P are signed by the sequencer key',
    relevance: 'A forged key can push fake pre-confirmed blocks to nodes',
    migrationStatus: 'No post-quantum block signing announced',
    alternative: 'Post-quantum sequencer signatures',
    compatibility: 'Node software change',
    confidence: 'HIGH',
    sources: ['base-p2p'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-VAL-02',
    category: 'VAL',
    primitive: 'Single Coinbase-operated sequencer',
    implementation: 'One operator orders and publishes all Base blocks',
    relevance: 'Its key management decides the sequencer’s quantum posture',
    migrationStatus: 'Controlled by Coinbase',
    alternative: 'Operator-side post-quantum key management',
    compatibility: 'External',
    confidence: 'MEDIUM',
    sources: ['l2beat-base', 'coinbase-pq'],
    status: 'EXTERNAL DEPENDENCY',
  },
  {
    id: 'BASE-VAL-03',
    category: 'VAL',
    primitive: 'Ethereum BLS12-381 validator signatures',
    implementation: 'Settlement layer consensus that Base posts batches to',
    relevance: 'Pairing-based; broken by Shor',
    migrationStatus: 'Ethereum targets post-quantum consensus by December 2029',
    alternative: 'Hash-based leanXMSS with SNARK aggregation (Ethereum research)',
    compatibility: 'External; inherited from Ethereum',
    confidence: 'HIGH',
    sources: ['eth-pq', 'eth-pq-roadmap', 'ef-protocol-2026'],
    status: 'EXTERNAL DEPENDENCY',
  },
  {
    id: 'BASE-WLT-01',
    category: 'WLT',
    primitive: 'BIP-32 secp256k1 derivation',
    implementation: 'Browser, mobile and hardware wallets',
    relevance: 'Every derived key is secp256k1',
    migrationStatus: 'Depends on wallet vendors',
    alternative: 'Post-quantum key generation and signing in wallets',
    compatibility: 'Ecosystem-wide',
    confidence: 'HIGH',
    sources: ['bip-32', 'eip-6963'],
    status: 'EXTERNAL DEPENDENCY',
  },
  {
    id: 'BASE-WLT-02',
    category: 'WLT',
    primitive: 'BIP-39 mnemonic (PBKDF2-HMAC-SHA512)',
    implementation: 'Seed generation and stretching',
    relevance: 'Hash-based; not a primary exposure',
    migrationStatus: 'Not required',
    alternative: 'Not required',
    compatibility: 'None',
    confidence: 'MEDIUM',
    sources: ['bip-39'],
    status: 'REVIEWED',
  },
  {
    id: 'BASE-BRG-01',
    category: 'BRG',
    primitive: 'Upgrade multisigs (secp256k1 Safe signers)',
    implementation: 'Coinbase 3-of-6 plus Security Council 8-of-11, combined 2-of-2',
    relevance: 'Forged signatures could upgrade the bridge contracts',
    migrationStatus: 'No post-quantum signers announced',
    alternative: 'Post-quantum multisig signers',
    compatibility: 'Governance change',
    confidence: 'HIGH',
    sources: ['base-security-council'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-RCV-01',
    category: 'RCV',
    primitive: 'No protocol-level recovery for EOAs',
    implementation: 'Owners must sign with the existing ECDSA key to move funds',
    relevance: 'Late migrators can be raced by an attacker',
    migrationStatus: 'Research proposal only (STARK proof of seed in an emergency fork)',
    alternative: 'Smart accounts with pre-registered post-quantum recovery owners',
    compatibility: 'Requires a migration window',
    confidence: 'MEDIUM',
    sources: ['eth-quantum-emergency', 'eth-accounts'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-PRF-01',
    category: 'PRF',
    primitive: 'TEE proofs: Nitro P-384 attestation, secp256k1 signers',
    implementation: 'TEEVerifier, TEEProverRegistry, NitroValidator, P384Verifier (Azul, Cobalt)',
    relevance: 'Forged attestations or signer keys could back an invalid checkpoint',
    migrationStatus: 'Classical throughout; overridable by a ZK proof',
    alternative: 'Post-quantum attestation and signer keys',
    compatibility: 'Contract and enclave change',
    confidence: 'HIGH',
    sources: ['base-azul-proofs', 'base-proof-contracts'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-PRF-02',
    category: 'PRF',
    primitive: 'SP1 proofs wrapped in BN254 Groth16 / PLONK',
    implementation: 'ZKVerifier through the SP1 verifier gateway',
    relevance: 'Pairing-based wrapper; forgeable under Shor',
    migrationStatus: 'The inner STARK is hash-based; the on-chain wrapper is not',
    alternative: 'Direct STARK verification on Ethereum',
    compatibility: 'Verifier contract change',
    confidence: 'MEDIUM',
    sources: ['base-proof-contracts', 'sp1-verification'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-PRF-03',
    category: 'PRF',
    primitive: 'KZG blob commitments (BLS12-381)',
    implementation: 'Batch data posted to Ethereum as EIP-4844 blobs',
    relevance: 'Pairing-based commitments; broken by Shor',
    migrationStatus: 'Ethereum plans post-quantum blobs (M*)',
    alternative: 'Hash-based data commitments',
    compatibility: 'External; inherited from Ethereum',
    confidence: 'HIGH',
    sources: ['eip-4844', 'eth-pq-roadmap'],
    status: 'EXTERNAL DEPENDENCY',
  },
  {
    id: 'BASE-PRF-04',
    category: 'PRF',
    primitive: 'BN254 and BLS12-381 precompiles',
    implementation: 'Used by applications to verify Groth16 and BLS signatures (EIP-2537 since Isthmus)',
    relevance: 'Pairing-based; broken by Shor',
    migrationStatus: 'Application-level',
    alternative: 'STARK-style hash-based proofs',
    compatibility: 'Per application',
    confidence: 'MEDIUM',
    sources: ['eip-2537', 'base-isthmus'],
    status: 'EXPOSED',
  },
  {
    id: 'BASE-EXT-01',
    category: 'EXT',
    primitive: 'TLS key exchange to RPC endpoints',
    implementation: 'HTTPS to Base and third-party RPC providers',
    relevance: 'Harvest now, decrypt later on transport traffic',
    migrationStatus: 'Hybrid ML-KEM reported at the public RPC edge by a third party; unconfirmed',
    alternative: 'X25519 + ML-KEM-768 (FIPS 203)',
    compatibility: 'Low; negotiated per connection',
    confidence: 'LOW',
    sources: ['layerqu-base', 'tls-mlkem', 'fips-203'],
    status: 'UNKNOWN',
  },
  {
    id: 'BASE-EXT-02',
    category: 'EXT',
    primitive: 'Oracle and RPC provider signatures',
    implementation: 'Third-party price feeds and infrastructure',
    relevance: 'Classical signatures outside protocol control',
    migrationStatus: 'Controlled by providers',
    alternative: 'Provider-side post-quantum signatures',
    compatibility: 'External',
    confidence: 'MEDIUM',
    sources: ['nist-ir-8547'],
    status: 'EXTERNAL DEPENDENCY',
  },
]

export const ANCESTOR_IDS = ['base', 'solana'] as const
export type AncestorId = (typeof ANCESTOR_IDS)[number]

/** The main chain: the Lab, scanner and reports start here. */
export const DEFAULT_ANCESTOR: AncestorId = 'base'

export const ANCESTOR_NAME: Record<AncestorId, string> = { base: 'BASE', solana: 'SOLANA' }

export interface AncestorModel {
  model: AnalysisModel
  loci: GenomeLocus[]
  findings: ExposureFinding[]
}

export const MODELS: Record<AncestorId, AncestorModel> = {
  base: { model: BASE_MODEL, loci: BASE_LOCI, findings: BASE_FINDINGS },
  solana: { model: SOLANA_MODEL, loci: SOLANA_LOCI, findings: SOLANA_FINDINGS },
}

/** The main chain's model, loci and findings. */
export const { model: MODEL, loci: LOCI, findings: FINDINGS } = MODELS[DEFAULT_ANCESTOR]

export function isAncestorId(value: string | null | undefined): value is AncestorId {
  return value === 'solana' || value === 'base'
}

/** Locus metadata by code for one ancestor. Organ parts are the same for every ancestor; names differ. */
export function lociByCode(ancestor: AncestorId = DEFAULT_ANCESTOR) {
  return Object.fromEntries(MODELS[ancestor].loci.map((locus) => [locus.code, locus])) as Record<CategoryCode, GenomeLocus>
}

export const LOCUS_BY_CODE = lociByCode(DEFAULT_ANCESTOR)

export function findingsFor(code: CategoryCode, ancestor: AncestorId = DEFAULT_ANCESTOR) {
  return MODELS[ancestor].findings.filter((finding) => finding.category === code)
}

const SEVERITY: FindingStatus[] = ['EXPOSED', 'EXTERNAL DEPENDENCY', 'UNKNOWN', 'EXPERIMENTAL', 'MIGRATION AVAILABLE', 'REVIEWED', 'NOT APPLICABLE']

/** The most severe status among a locus's findings; ordering follows SEVERITY. */
export function locusStatus(code: CategoryCode, ancestor: AncestorId = DEFAULT_ANCESTOR): FindingStatus {
  const statuses = findingsFor(code, ancestor).map((finding) => finding.status)
  return SEVERITY.find((status) => statuses.includes(status)) ?? 'UNKNOWN'
}

export function exposureCounts(findings: ExposureFinding[] = MODELS[DEFAULT_ANCESTOR].findings) {
  const counts = Object.fromEntries(FINDING_STATUSES.map(({ status }) => [status, 0])) as Record<FindingStatus, number>
  for (const finding of findings) counts[finding.status] += 1
  return counts
}

export function exposedParts(ancestor: AncestorId = DEFAULT_ANCESTOR): OrganPart[] {
  return Array.from(new Set(MODELS[ancestor].loci.filter((locus) => locusStatus(locus.code, ancestor) === 'EXPOSED').map((locus) => locus.part)))
}
