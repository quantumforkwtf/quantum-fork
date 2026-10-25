export type SourceKind = 'standard' | 'paper' | 'repository' | 'documentation' | 'proposal' | 'research'

export interface Source {
  id: string
  title: string
  publisher: string
  kind: SourceKind
  url: string
  /** Optional note on how the source should be read, e.g. draft status. */
  note?: string
}

const list = [
  { id: 'fips-203', title: 'FIPS 203: Module-Lattice-Based Key-Encapsulation Mechanism Standard (ML-KEM)', publisher: 'NIST', kind: 'standard', url: 'https://csrc.nist.gov/pubs/fips/203/final' },
  { id: 'fips-204', title: 'FIPS 204: Module-Lattice-Based Digital Signature Standard (ML-DSA)', publisher: 'NIST', kind: 'standard', url: 'https://csrc.nist.gov/pubs/fips/204/final' },
  { id: 'fips-205', title: 'FIPS 205: Stateless Hash-Based Digital Signature Standard (SLH-DSA)', publisher: 'NIST', kind: 'standard', url: 'https://csrc.nist.gov/pubs/fips/205/final' },
  { id: 'fips-206', title: 'FIPS 206: FN-DSA (Falcon)', publisher: 'NIST', kind: 'standard', url: 'https://csrc.nist.gov/Presentations/2025/fips-206-fn-dsa-falcon', note: 'Not a final standard. Treat parameters as subject to change.' },
  { id: 'nist-pqc', title: 'Post-Quantum Cryptography project', publisher: 'NIST', kind: 'documentation', url: 'https://csrc.nist.gov/projects/post-quantum-cryptography' },
  { id: 'nist-ir-8547', title: 'NIST IR 8547: Transition to Post-Quantum Cryptography Standards', publisher: 'NIST', kind: 'standard', url: 'https://csrc.nist.gov/pubs/ir/8547/ipd', note: 'Initial public draft.' },
  { id: 'rfc-8032', title: 'RFC 8032: Edwards-Curve Digital Signature Algorithm (EdDSA)', publisher: 'IETF', kind: 'standard', url: 'https://www.rfc-editor.org/rfc/rfc8032' },
  { id: 'shor-1994', title: 'Polynomial-Time Algorithms for Prime Factorization and Discrete Logarithms on a Quantum Computer', publisher: 'P. Shor', kind: 'paper', url: 'https://arxiv.org/abs/quant-ph/9508027' },
  { id: 'grover-1996', title: 'A fast quantum mechanical algorithm for database search', publisher: 'L. Grover', kind: 'paper', url: 'https://arxiv.org/abs/quant-ph/9605043' },
  { id: 'tls-mlkem', title: 'Hybrid ECDHE-MLKEM key agreement for TLS 1.3', publisher: 'IETF', kind: 'proposal', url: 'https://datatracker.ietf.org/doc/draft-ietf-tls-ecdhe-mlkem/', note: 'Internet-Draft.' },
  { id: 'solana-transactions', title: 'Transactions (size limits and signatures)', publisher: 'Solana', kind: 'documentation', url: 'https://solana.com/docs/core/transactions' },
  { id: 'solana-accounts', title: 'Accounts', publisher: 'Solana', kind: 'documentation', url: 'https://solana.com/docs/core/accounts' },
  { id: 'solana-pda', title: 'Program Derived Addresses', publisher: 'Solana', kind: 'documentation', url: 'https://solana.com/docs/core/pda' },
  { id: 'solana-quantum', title: "Solana's Quantum Readiness", publisher: 'Solana Foundation', kind: 'research', url: 'https://solana.com/news/quantum-readiness' },
  { id: 'anagram-pq', title: 'Taking Solana Post-Quantum', publisher: 'Anagram', kind: 'research', url: 'https://blog.anagram.xyz/taking-solana-post-quantum/' },
  { id: 'blueshift-pq', title: 'Quantum-Proofing Solana (Winternitz Vault, Winterwallet)', publisher: 'Blueshift', kind: 'research', url: 'https://blueshift.gg/research/quantum-proofing-solana' },
  { id: 'blueshift-falcon', title: 'solana-falcon512: Falcon-512 verification in SBF programs', publisher: 'Blueshift', kind: 'repository', url: 'https://github.com/blueshift-gg/solana-falcon512' },
  { id: 'simd-0461', title: 'SIMD-0461: Falcon signature verification syscall', publisher: 'Solana Improvement Documents', kind: 'proposal', url: 'https://github.com/solana-foundation/solana-improvement-documents/pull/461', note: 'Closed by its author in June 2026, pending demand.' },
  { id: 'simd-0296', title: 'SIMD-0296: Larger transactions (1,232 → 4,096 bytes)', publisher: 'Solana Improvement Documents', kind: 'proposal', url: 'https://github.com/solana-foundation/solana-improvement-documents/pulls?q=0296' },
  { id: 'simd-0326', title: 'SIMD-0326: Alpenglow consensus', publisher: 'Solana Improvement Documents', kind: 'proposal', url: 'https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0326-alpenglow.md' },
  { id: 'simd-0387', title: 'SIMD-0387: BLS public key management in vote accounts', publisher: 'Solana Improvement Documents', kind: 'proposal', url: 'https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0387-bls-pubkey-management-in-vote-account.md' },
  { id: 'solana-alpenglow', title: 'Alpenglow upgrade status', publisher: 'Solana', kind: 'documentation', url: 'https://solana.com/upgrades/alpenglow' },
  { id: 'simd-index', title: 'Solana Improvement Documents', publisher: 'Solana Foundation', kind: 'proposal', url: 'https://github.com/solana-foundation/solana-improvement-documents' },
  { id: 'token-2022-status', title: 'Token-2022 project status (confidential transfers)', publisher: 'Solana Program Library', kind: 'documentation', url: 'https://www.solana-program.com/docs/token-2022/status' },
  { id: 'agave', title: 'Agave validator client', publisher: 'Anza', kind: 'repository', url: 'https://github.com/anza-xyz/agave' },
  { id: 'firedancer', title: 'Firedancer validator client', publisher: 'Jump Crypto', kind: 'repository', url: 'https://github.com/firedancer-io/firedancer' },
  { id: 'liboqs', title: 'liboqs: Open Quantum Safe', publisher: 'Open Quantum Safe', kind: 'repository', url: 'https://github.com/open-quantum-safe/liboqs' },
  { id: 'pqclean', title: 'PQClean: clean implementations of PQ schemes', publisher: 'PQClean', kind: 'repository', url: 'https://github.com/PQClean/PQClean' },
  { id: 'rustcrypto-signatures', title: 'RustCrypto signatures (ml-dsa, slh-dsa crates)', publisher: 'RustCrypto', kind: 'repository', url: 'https://github.com/RustCrypto/signatures' },
  { id: 'rustls', title: 'rustls (TLS 1.3, hybrid ML-KEM key exchange)', publisher: 'rustls', kind: 'repository', url: 'https://github.com/rustls/rustls' },
  { id: 'wormhole', title: 'Wormhole guardian network', publisher: 'Wormhole Foundation', kind: 'repository', url: 'https://github.com/wormhole-foundation/wormhole' },
  { id: 'bip-39', title: 'BIP-39: Mnemonic code for generating deterministic keys', publisher: 'Bitcoin BIPs', kind: 'standard', url: 'https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki' },
  { id: 'slip-0010', title: 'SLIP-0010: Universal private key derivation from master key', publisher: 'SatoshiLabs', kind: 'standard', url: 'https://github.com/satoshilabs/slips/blob/master/slip-0010.md' },
  { id: 'wallet-standard', title: 'Wallet Standard', publisher: 'Wallet Standard', kind: 'repository', url: 'https://github.com/wallet-standard/wallet-standard' },
  { id: 'spl-memo', title: 'Memo program', publisher: 'Solana Program Library', kind: 'documentation', url: 'https://www.solana-program.com/docs/memo' },
  { id: 'pump-docs', title: 'Pump public docs and IDL', publisher: 'Pump', kind: 'documentation', url: 'https://github.com/pump-fun/pump-public-docs' },
  { id: 'eth-accounts', title: 'Ethereum accounts (EOAs, keys and addresses)', publisher: 'ethereum.org', kind: 'documentation', url: 'https://ethereum.org/developers/docs/accounts/' },
  { id: 'eth-pq', title: 'Post-quantum cryptography on Ethereum', publisher: 'ethereum.org', kind: 'documentation', url: 'https://ethereum.org/roadmap/security/quantum-resistance/' },
  { id: 'eth-pq-roadmap', title: 'pq.ethereum.org: Post-Quantum Ethereum roadmap', publisher: 'Ethereum Foundation', kind: 'research', url: 'https://pq.ethereum.org/', note: 'Living roadmap; fork milestones are planning targets.' },
  { id: 'ef-protocol-2026', title: 'EF Protocol: Current and Emerging Priorities (Sept 2026)', publisher: 'Ethereum Foundation', kind: 'research', url: 'https://blog.ethereum.org/2026/09/07/protocol-priorities', note: 'States a December 2029 target, to be reassessed in January 2027.' },
  { id: 'eth-quantum-emergency', title: "How to hard-fork to save most users' funds in a quantum emergency", publisher: 'V. Buterin (ethresear.ch)', kind: 'research', url: 'https://ethresear.ch/t/how-to-hard-fork-to-save-most-users-funds-in-a-quantum-emergency/18901', note: 'Research proposal, not a scheduled change.' },
  { id: 'eip-4844', title: 'EIP-4844: Shard blob transactions (KZG commitments)', publisher: 'Ethereum EIPs', kind: 'standard', url: 'https://eips.ethereum.org/EIPS/eip-4844' },
  { id: 'eip-2537', title: 'EIP-2537: Precompile for BLS12-381 curve operations', publisher: 'Ethereum EIPs', kind: 'standard', url: 'https://eips.ethereum.org/EIPS/eip-2537' },
  { id: 'erc-4337', title: 'ERC-4337: Account Abstraction Using Alt Mempool', publisher: 'Ethereum', kind: 'standard', url: 'https://eips.ethereum.org/EIPS/eip-4337' },
  { id: 'rip-7212', title: 'RIP-7212: Precompile for secp256r1 Curve Support', publisher: 'Rollup Improvement Proposals', kind: 'proposal', url: 'https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md' },
  { id: 'foundry-anvil', title: 'Anvil: local Ethereum node', publisher: 'Foundry', kind: 'documentation', url: 'https://getfoundry.sh/anvil/overview' },
  { id: 'op-stack-deploy', title: 'Deploying an OP Stack chain', publisher: 'Optimism', kind: 'documentation', url: 'https://docs.optimism.io/operators/chain-operators/deploy/overview' },
  { id: 'eip-7702', title: 'EIP-7702: Set code for EOAs', publisher: 'Ethereum EIPs', kind: 'standard', url: 'https://eips.ethereum.org/EIPS/eip-7702' },
  { id: 'eip-6963', title: 'EIP-6963: Multi Injected Provider Discovery', publisher: 'Ethereum EIPs', kind: 'standard', url: 'https://eips.ethereum.org/EIPS/eip-6963' },
  { id: 'bip-32', title: 'BIP-32: Hierarchical Deterministic Wallets', publisher: 'Bitcoin BIPs', kind: 'standard', url: 'https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki' },
  { id: 'base-fjord', title: 'Fjord upgrade (RIP-7212 secp256r1 precompile)', publisher: 'Base', kind: 'documentation', url: 'https://docs.base.org/upgrades/fjord/overview' },
  { id: 'base-isthmus', title: 'Isthmus upgrade (EIP-7702, EIP-2537)', publisher: 'Base', kind: 'documentation', url: 'https://docs.base.org/upgrades/isthmus/overview' },
  { id: 'base-precompiles', title: 'Base precompiles (P256VERIFY)', publisher: 'Base', kind: 'documentation', url: 'https://docs.base.org/specifications/base-protocol/execution/precompiles' },
  { id: 'base-p2p', title: 'Base P2P: sequencer block signatures', publisher: 'Base', kind: 'documentation', url: 'https://docs.base.org/specifications/base-protocol/consensus/p2p' },
  { id: 'base-azul-proofs', title: 'Azul proof system (TEE + ZK AggregateVerifier)', publisher: 'Base', kind: 'documentation', url: 'https://docs.base.org/upgrades/azul/proofs' },
  { id: 'base-proof-contracts', title: 'Base proof contracts (TEEVerifier, ZKVerifier, NitroValidator, P384Verifier)', publisher: 'Base', kind: 'documentation', url: 'https://docs.base.org/specifications/base-protocol/proofs/proof-contracts' },
  { id: 'base-security-council', title: 'Security Council for Base', publisher: 'Base', kind: 'documentation', url: 'https://docs.base.org/base-chain/security/security-council' },
  { id: 'base-upgrades', title: 'Base network upgrades', publisher: 'Base', kind: 'documentation', url: 'https://docs.base.org/upgrades/overview' },
  { id: 'base-8130', title: 'Native Account Abstraction (EIP-8130) on Base', publisher: 'Base', kind: 'documentation', url: 'https://docs.base.org/specifications/native-account-abstraction', note: 'Experimental; runs only on the vibenet devnet.' },
  { id: 'coinbase-pq', title: 'What Coinbase is Doing to Prepare for Post-Quantum Cryptography', publisher: 'Coinbase', kind: 'research', url: 'https://www.coinbase.com/en-gb/blog/what-coinbase-is-doing-to-prepare-for-post-quantum-cryptography' },
  { id: 'coinbase-smart-wallet', title: 'Coinbase Smart Wallet (passkey and address owners)', publisher: 'Coinbase', kind: 'repository', url: 'https://github.com/coinbase/smart-wallet' },
  { id: 'sp1-verification', title: 'SP1 on-chain verification (Groth16 / PLONK over BN254)', publisher: 'Succinct', kind: 'documentation', url: 'https://docs.succinct.xyz/docs/sp1/verification/getting-started' },
  { id: 'l2beat-base', title: 'Base: risk analysis', publisher: 'L2BEAT', kind: 'research', url: 'https://l2beat.com/scaling/projects/base' },
  { id: 'layerqu-base', title: 'Base: post-quantum readiness scorecard', publisher: 'LayerQu', kind: 'research', url: 'https://layerqu.com/chains/base/', note: 'Third-party assessment; not independently verified here.' },
] as const satisfies readonly Source[]

export type SourceId = (typeof list)[number]['id']

export const SOURCES: readonly Source[] = list

export const SOURCE_BY_ID = Object.fromEntries(list.map((source) => [source.id, source])) as Record<SourceId, Source>

export function sourcesFor(ids: readonly SourceId[]): Source[] {
  return ids.map((id) => SOURCE_BY_ID[id])
}
