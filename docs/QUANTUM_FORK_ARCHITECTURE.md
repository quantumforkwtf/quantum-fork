# Quantum Fork architecture

Status of this document: describes the code on branch `base` as audited on 2026-10-25, then the
additions planned around it. Anything not marked *exists* is a proposal. Feature-level status
lives in [`FEATURE_STATUS.md`](./FEATURE_STATUS.md); sequencing and acceptance criteria live in
[`IMPLEMENTATION_ROADMAP.md`](./IMPLEMENTATION_ROADMAP.md).

## 1. What Quantum Fork is, precisely

Quantum Fork is a web application for designing blockchain environments, checking what each
design would really need, and recording designs verifiably. It does **not** operate a blockchain.

Three deployment targets are distinguished everywhere in the product and in the code
(`src/protocol/chainDna.ts`, `TARGETS`):

| Target | What it is | Independent chain? | Who runs it |
| --- | --- | --- | --- |
| Contracts on Base | Smart contracts deployed to Base or Base Sepolia | **No.** An application on Base | Base runs consensus, sequencing and execution |
| Local devnet (Anvil) | An Anvil node on the user's machine, optionally forked from Base state | **No.** A development simulator | The user |
| Dedicated OP Stack rollup | A separate L2/L3 settling to Base or Ethereum | **Yes** | Whoever operates the sequencer, batcher and proposer. Quantum Fork does not operate one |

A smart contract is never described as an independent blockchain. A fork of Base state is never
described as holding real or transferable assets.

## 2. System as it exists

```
Browser (Vite + React SPA)                         Vercel Functions (/api)                 Chains
─────────────────────────────                      ─────────────────────────────          ─────────────
pages/            routes, one file each            status     capability + flags           Solana
components/       chrome, wallet, dna, network     configs    Chain DNA publish/anchor     Base / Base Sepolia
lib/solana/       wallet-standard, tx encoding     deployments  descendant registration    Pump.fun (via PumpPortal)
lib/evm/          EIP-6963, burn, Clanker, anchor  burns      server-side burn verification Clanker v4 factory
lab/              genome, glyphs, registry cache   tokens     SPL / Pump.fun / Clanker     QForkRegistry (Foundry)
protocol/  ◄────── shared domain, imported by both ──────►    descendants, token, faucet, og, page, log, scan
                                                   _lib/store Upstash Redis or memory
```

### 2.1 Client *exists*

- **Router**: a small path matcher in `src/App.tsx` with `src/router.tsx` (`Link`, `navigate`) and
  `src/navigation.ts`. Pages are lazy chunks. `usePageMeta` sets title, description and canonical URL.
- **Solana**: wallet-standard discovery, hand-serialised transactions (BurnChecked + Memo, SPL mint
  creation, Pump.fun co-signing). `signTransaction` only; the signed bytes are compared to what was
  built (`TX_MODIFIED`).
- **Base / EVM**: EIP-6963 wallet discovery (`src/lib/evm/wallet.ts`), chain switching, ERC-20 burn
  with a 32-byte deployment tag appended to calldata (`burn.ts`), Clanker v4 launch (`launch.ts`),
  registry anchoring (`anchor.ts`). viem is the only EVM dependency; wagmi is not used because the
  app needs one wallet connection and no React query cache.
- **Three.js**: reactor and organism scenes in a lazily loaded `engine` chunk, with a 2D fallback.
- **Chain DNA studio** at `/create` and the explorer at `/explore` (section 3).

### 2.2 Server *exists*

- `api/_lib/http.ts`: `route()` wrapper with JSON-only bodies, a 16 KB limit, an origin allowlist on
  writes, zod validation (`readJson`), per-IP rate limits and typed `HttpError`s.
- `api/_lib/store.ts`: Upstash Redis when `KV_REST_API_*` is set; otherwise an in-memory store that
  reports `persistent: false`. Every write path that must survive a cold start refuses to run on
  memory storage.
- `api/_lib/env.ts`: the single configuration resolver. Inconsistent settings resolve to the safer
  value and are reported as issues in `/api/status`. Dangerous switches default to false.
- **Verification rule**: the server never trusts client-reported wallets, amounts, success or
  deployment state. It reads the transaction itself, at finalized commitment (Solana) or a finalized
  block (Base), and records write-once.

### 2.3 Domain (`src/protocol`) *exists*

Shared by client and server, so the same rules run in both places.

| Module | Responsibility |
| --- | --- |
| `ancestors.ts`, `sources.ts` | Sequenced ancestors (Solana, Base) and their cited findings |
| `descendant.ts`, `blueprints.ts`, `blueprintCompiler.ts` | The original Solana-descendant genome and blueprints |
| `deployment.ts`, `verifyBurn.ts`, `receipt.ts` | Registration state machine (ends at REGISTERED), Solana burn verification |
| `base.ts` | Base configuration, burn calldata and tag, ERC-20 burn verification |
| `clanker.ts`, `tokens.ts` | Token launch specs and verification (SPL, Pump.fun, Clanker v4) |
| `chainDna.ts` | Chain DNA v1: schema, per-target support matrix, validation, readiness, hashing, Anvil args |
| `registry.ts` | QForkRegistry ABI, calldata and receipt verification |

### 2.4 Contracts *exists*

`contracts/` is a Foundry project (solc 0.8.28, forge-std 1.9.7 vendored).

`QForkRegistry.sol` is a permissionless, ownerless, non-upgradeable record of configuration hashes:

- `register(configHash, kind, metadataURI)` creates `recordId = keccak256(abi.encode(creator, configHash))`.
- `registerVersion(parent, configHash, kind, uri)` links a new version to the creator's own parent.
- `updateMetadata(id, uri)` is restricted to the creator.
- It has no fees, holds no funds, rejects ETH, and caps URIs at 512 bytes.

It records **that an address published a hash**. It does not attest that the configuration is
safe, deployed or running. Deployment: `contracts/script/Deploy.s.sol` refuses any chain other
than Base Sepolia (84532) or Anvil (31337) unless `ALLOW_MAINNET=true` is set explicitly.

## 3. Chain DNA *exists*

Chain DNA (`qfork/chain-dna/v1`) is a strict, versioned JSON document describing one environment.

```
spec · name · description · target
network       chainId, settlement, fork {source, block}, access, blockTimeMs, gasLimit
economics     nativeCurrency, baseFeeGwei, feePolicy, treasury, token, distribution[]
execution     evm, precompiles[], accountAbstraction[], upgrades
security      admin, governance, sequencing, keys
privacy       execution, zkVerifier, disclosure
cryptography  auth, rotation
```

Every selectable option declares its support **per target** (`FIELDS`):

| Support | Meaning |
| --- | --- |
| `native` (BUILT IN) | The target provides it today |
| `contracts` (YOUR CONTRACTS) | Possible, but you deploy and maintain contracts for it |
| `infrastructure` (NEEDS INFRASTRUCTURE) | Possible only if someone operates the components |
| `research` (RESEARCH) | No production path; warned, never offered as deployable |
| `unsupported` (NOT POSSIBLE) | Rejected on that target and disabled in the UI |

Each option is also classed by **layer** (contract, application, infrastructure, execution client,
consensus), which is how the studio shows what changes where.

Pipeline:

1. `normalizeDna` pins the values a target fixes (for example, Base's chain ID, 2 s block time and
   Prague EVM), sorts arrays and removes duplicates.
2. `validateDna` raises errors for impossible combinations and warnings for risky ones (for
   example, ML-DSA alongside EIP-7702 still lets the ECDSA key control the account).
3. `readiness` and `infrastructure` derive what can be done now, what is blocked and who would
   operate each component, without invented capacity or performance numbers.
4. `dnaHash` is keccak256 over `"qfork/chain-dna/v1:" + canonicalJson(dna)`. `technicalHash`
   excludes name and description, so renaming keeps the genome glyph.
5. `anvilArgs` turns a local-devnet DNA into flags for a real Anvil command; tests boot Anvil with
   them and read the result back.

### 3.1 Publishing and anchoring

```
studio ── POST /api/configs {publish} ──► server normalises, validates, hashes ──► qf:dna:<hash> (write-once)
studio ── wallet: QForkRegistry.register(hash, kind, uri) ──► Base Sepolia
studio ── POST /api/configs {verify-anchor, hash, txHash} ──► server reads tx + receipt at a finalized block
                                                             checks chain, contract, sender, event, kind
                                                             ──► qf:anchor:<recordId> (write-once), tx bound once
```

The client never decides that an anchor exists. `PENDING` is returned until the block is
finalized.

## 4. Proposed additions

Each addition keeps one rule: a capability appears as usable only after its acceptance tests
pass against the real component.

### 4.1 Reality Fork (Phase 2) *local version exists*

Purpose: run a transaction or scenario against a fork of Base and against a modified fork, then
compare state.

What exists (`src/protocol/realityFork.ts`, `src/lib/evm/forkRpc.ts`, `/lab/reality-fork`):

- The user starts two Anvil forks of one block. The browser talks to them directly. The client
  refuses any endpoint that is not `http://127.0.0.1` or `http://localhost`, so Anvil-only
  methods never reach a public network.
- Identity: `anvil_metadata` must report Anvil, the expected chain ID and fork block, and a fork
  block hash equal to the hash the real network's public RPC returns for that block.
- Run: snapshot, fund senders (optional, both forks), apply modifications (modified fork only),
  impersonate senders, then for each call pin the next block's timestamp (fork block + 2 s per
  call) and base fee (fork block's), send, read the receipt, `callTracer` and `prestateTracer`
  (diff mode), and finally revert to the snapshot. Pinning makes two unmodified forks agree
  exactly; a test asserts that.
- No wallet signs anything, so no signature produced on a fork could be replayed on Base.

What follows is the hosted design.

- **Engine**: Anvil `--fork-url` pinned to a block, with snapshots and `anvil_setCode` /
  `anvil_setStorageAt` for modifications. Uses only standard Anvil RPC.
- **Boundary**: a `ForkProvider` interface with `create(spec) → {rpcUrl, expiresAt}`, `snapshot`,
  `revert`, `destroy`. The local implementation spawns Anvil. A hosted implementation needs
  isolated compute (section 4.6) and is blocked until it exists.
- **UI** (`/lab/reality-fork`): two panes (original and fork) showing calls, traces
  (`debug_traceTransaction`), balance and storage diffs. Every pane carries the fork block and a
  "FORK — NOT BASE" banner. No value on a fork is presented as real.

### 4.2 Ghost Chains (Phase 3)

Local version (`/lab/ghost-chains`, `POST /api/ghosts`): one Anvil process per environment, bound to 127.0.0.1, with a 15 minute, 1 hour, 6 hour or 24 hour TTL, a unique chain id, a two-environment quota, `anvil_dumpState` export, and kill on terminate. The endpoint returns 501 on a hosted server. The dev server keeps the process table in memory, so a restart drops it.

Hosted environments still need the isolated runtime below.

Ephemeral environments with an explicit lifecycle:

```
CREATING → INITIALIZING → RUNNING → EXPIRING → TERMINATED
            └──────────────── FAILED (any stage) ───────┘
```

- **Requirements**: an isolated runner (one container per environment), an authenticated RPC
  proxy with per-key rate limits, hard TTLs, and resource quotas.
- **Not allowed**: unauthenticated public RPC, or code from users running on the application
  server.
- **State machine**: a pure module in `src/protocol` (like `deployment.ts`), so transitions can be
  tested without infrastructure.

### 4.3 Quantum Shield (Phase 4)

Post-quantum signature experiments on top of accounts. Nothing in Base changes.

- **Libraries**: established implementations only, for example `@noble/post-quantum` (ML-DSA
  FIPS 204, SLH-DSA FIPS 205). No primitives are written here.
- **Onchain path**: ERC-4337 smart accounts whose validator verifies a post-quantum signature.
  This needs a verifier contract; gas costs must be measured on Anvil and reported as measured.
- **Benchmarks**: key and signature sizes, and sign/verify times on the user's own device, shown
  with the device and library version. No invented figures.
- **Limits stated in the UI**: the account's other keys, the chain's ECDSA-signed transactions,
  sequencer keys and bridges stay classical.

### 4.4 Lab modules (Phase 5)

| Module | Real basis | Hard limit |
| --- | --- | --- |
| Fork Wars | Local Anvil only (`POST /api/benchmarks` returns 501 when `VERCEL` is set or `NODE_ENV` is production). Two allowlisted profiles, six fixed contracts from `contracts/src/bench/Workloads.sol`. Latency is send-to-receipt wall clock. CPU and RSS are `ps` samples of the Anvil pid | Not a Base measurement and not a network TPS claim. A short run can show 0% CPU because that is what `ps` returned |
| Time Machine | Local Anvil fork of the parent block, then ordered replay of every preceding transaction (including OP deposit transactions) before the target. Status, gas and logs are compared with the real receipt. A fork of the transaction's own block is the post-state and is not used | Blocks the public RPC no longer serves need an archive endpoint. Blob (type 3) and 7702 (type 4) transactions are refused because the RPC does not return their sidecars |
| Mutation Engine | Local lineage of Chain DNA (`/lab/mutation`). `planUpgrade` classifies each diff: contract, built-in, local Anvil, dedicated chain, research, or impossible. A target switch is a different environment, not a modification of the previous chain | Recording a branch or a rollback writes a revision in this browser. It does not send a transaction or change Base |
| Privacy Lab | A real proof system (Noir/UltraHonk or Circom/Groth16) with a verifier contract on Anvil | Proofs are generated for real or not at all. Frontend encryption is not described as onchain privacy |

### 4.5 Platform (Phase 6)

Marketplace (signed, reviewed modules), Chain Autopilot (AI suggestions that require explicit
human approval for any privileged action), adapters for other OP Stack providers, billing and SDKs.
Every one of these depends on authentication, isolated execution and a billing provider, none of
which exist yet.

### 4.6 Infrastructure boundary

Quantum Fork currently has no compute beyond Vercel Functions. Anything that runs a node, a
sequencer or user code needs a separate, isolated runtime with:

- an authenticated control API (no credentials in the frontend);
- per-environment containers with CPU, memory, disk and TTL limits;
- an RPC gateway with API keys, rate limits, and method allowlists;
- audit logs for every privileged action.

Until that runtime exists, these features are implemented and tested only against a local
boundary (Anvil on the developer's machine) and are marked BLOCKED in the product.

## 5. Security model (summary)

- Secrets are server-only and never `VITE_`-prefixed. No private keys or seed phrases are ever
  requested.
- Every value-moving or state-claiming action is verified server-side from the chain.
- Base mainnet writes need an explicit configuration change. Scripts refuse mainnet unless told
  otherwise.
- No outside security review has been done. See `protocol/THREAT_MODEL.md` and
  `PRODUCTION_READINESS.md`.
