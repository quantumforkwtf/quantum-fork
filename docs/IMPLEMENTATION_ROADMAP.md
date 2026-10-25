# Implementation roadmap

Each phase lists its dependencies, risks and acceptance criteria. A phase item is **done** only
when its acceptance criteria pass against the real component named in the criteria. A screen
that looks complete is not done. Current status per feature: [`FEATURE_STATUS.md`](./FEATURE_STATUS.md).

Rules that apply to every phase:

- Base Sepolia first. Nothing is sent to Base mainnet without explicit authorization.
- No token deployment without an explicit instruction.
- No invented metrics, users, activity, TPS or benchmark numbers.
- Missing infrastructure is documented as a blocker, with the local integration boundary
  implemented and tested. It is never replaced by a fake endpoint.

---

## Phase 1: Foundation (Chain DNA, Genesis Studio, registry)

| Item | Depends on | Acceptance criteria |
| --- | --- | --- |
| Repository audit | — | Architecture document describes the existing client, server, domain and integrations |
| Chain DNA v1 schema | — | Strict zod schema; every option declares support for all three targets; unit tests cover Base locks, impossible options, cross-field conflicts, canonical hashing, share round-trip, diff |
| Genesis Studio `/create` | Chain DNA | Unsupported options are disabled; research options are labelled; errors block publishing; export/import/share links round-trip; browser check passes on desktop and mobile with no console errors |
| Local persistence | Studio | Saved library in localStorage (≤50), duplicate, delete, compare |
| Server persistence | Redis | `POST /api/configs` rejects unnormalised or invalid documents, computes the hash server-side, is idempotent, and refuses to run on memory storage |
| QForkRegistry contract | Foundry | Unit and fuzz tests pass (`forge test`); no owner, fees or upgrade path; deploy script refuses mainnet by default |
| Anchor verification | Registry, Base RPC | End-to-end test against a real Anvil node: publish → register → PENDING before finality → VERIFIED → idempotent; rejects wrong contract, wrong kind, failed tx, unregistered hash |
| Anvil command generation | Chain DNA | A test boots Anvil with the generated flags and reads back chain ID, gas limit and precompile availability |
| Registry on Base Sepolia | Funded deployer key held by the operator | `QFORK_REGISTRY_ADDRESS` set; one anchor verified through the browser with a real wallet |
| Explorer `/explore` | Server persistence | Lists only published configurations; anchors link to BaseScan; empty and no-storage states are explicit |

Risks: Base fixes more parameters than users expect (mitigated by locking fields and saying so);
users may read a registry record as a deployment (mitigated by copy on every anchor: "records a
hash, does not deploy"); memory storage in development hides persistence bugs (mitigated by the
storage gate).

## Phase 2: Reality Fork

| Item | Depends on | Acceptance criteria |
| --- | --- | --- |
| `ForkProvider` interface and local Anvil implementation **(done: user-run Anvil, browser-driven)** | Anvil | Tests create a fork of Base Sepolia at a pinned block, read a known contract's state, snapshot, modify code/storage, revert, and destroy |
| Scenario runner **(done)** | ForkProvider | Executes a sequence of calls on both original and modified forks; returns receipts, traces and state diffs; deterministic across runs at the same block |
| Split-screen UI `/lab/reality-fork` **(done, local)** | Runner | Both panes show the fork block and a "fork, not Base" label; diffs come from real traces; disabled with a stated reason when no fork runtime is available |
| Hosted forks | Isolated runtime (Phase 3) | Blocked until the runtime exists |

Risks: public RPCs rate-limit fork reads (needs a dedicated archive RPC); users may treat forked
balances as real (labels and no export of forked "assets").

## Phase 3: Ghost Chains

| Item | Depends on | Acceptance criteria |
| --- | --- | --- |
| Lifecycle state machine **(done)** | — | Pure module; tests cover allowed and forbidden transitions and expiry before the deadline |
| Local runner `/lab/ghost-chains` **(done, local)** | Anvil on the operator's machine | One process per environment, loopback only, TTL, two-environment quota, snapshot, kill on terminate |
| Isolated runner | Container host, budget approval | One container per environment with CPU/memory/disk/TTL limits; teardown verified |
| Authenticated RPC gateway | Runner | API keys, per-key rate limits, method allowlist; unauthenticated requests rejected in tests |
| `/cloud/ghost-chains` | All above | Shows only environments that exist on the runner, with their real status |

Blockers: no container host or budget exists. Purchasing infrastructure requires explicit
authorization.

## Phase 4: Quantum Shield

| Item | Depends on | Acceptance criteria |
| --- | --- | --- |
| ML-DSA / SLH-DSA in the browser **(done)** | `@noble/post-quantum` 0.7.1 | NIST ACVP keyGen (ML-DSA, SLH-DSA) and sigVer (ML-DSA) vectors pass in `tests/pqSignatures.test.ts` |
| Local benchmarks **(done)** | Above | Measured in a Web Worker on the user's device; displayed with device, browser and library version; no hard-coded numbers |
| PQ-validated smart account | ERC-4337 EntryPoint, verifier contract | Foundry tests: a UserOperation signed with ML-DSA is accepted, a tampered one rejected; gas measured on Anvil and reported as measured |
| `/lab/quantum-shield` | Above | States what stays classical (transaction envelope, sequencer, bridges, other keys); never claims Base is quantum-resistant |

Risks: on-chain verification of lattice signatures is gas-heavy and may be impractical; that is
a result to report, not hide. Any verifier contract needs cryptographic review before holding value.

## Phase 5: Lab modules

| Module | Acceptance criteria |
| --- | --- |
| Fork Wars **(done, local)** | Two fresh Anvil profiles run one fixed workload. The report is measured gas, latency, throughput, failures, and `ps` samples of the Anvil process. The endpoint that starts Anvil is refused on a hosted server |
| Time Machine **(done, local)** | Forks the parent block and resubmits earlier transactions in order, including Base deposits. A pinned Base Sepolia transaction matches status, gas, logs and block number. Calldata, value and gas can be edited; the fork is reverted. Blob and 7702 transactions are refused. Blocks older than the public RPC retains still need an archive endpoint |
| Mutation Engine **(done, local)** | Versions Chain DNA, branches from any revision, and classifies every diff. Execution-client and consensus changes on Base are marked impossible for a contract. Nothing is deployed |
| Privacy Lab | Real proof generation (Noir/UltraHonk or Circom/Groth16) and verification by a contract on Anvil; tests include an invalid proof being rejected |

## Phase 6: Platform

Marketplace, Chain Autopilot, provider adapters, billing and SDKs.

| Item | Acceptance criteria |
| --- | --- |
| Marketplace | Modules are signed, versioned and reviewed; nothing user-supplied runs on the app server |
| Chain Autopilot | Suggestions only; every privileged change needs an explicit human approval recorded in an audit log |
| Provider adapters | Each adapter is tested against the provider's real sandbox before it is listed |
| Billing | Real provider integration in test mode; no charges without explicit authorization |
| SDKs | Typed client for `/api/configs` and the registry, generated from the same schemas |

Dependencies: authentication, isolated runtime, legal review of paid services.

---

## Order of work and blockers

```
Phase 1 ──► Phase 2 (local) ──► Phase 4 (browser + Anvil) ──► Phase 5 (local parts)
   │                 │
   └─ Sepolia deploy ┘ blocked on a funded deployer key held by the operator
Phase 3 / hosted Phase 2 / Phase 6 ── blocked on an isolated runtime and budget approval
```

The Sepolia registry deployment is run by the operator:

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url base_sepolia --account <keystore-name> --broadcast --verify
```

Then set `QFORK_REGISTRY_ADDRESS` (server) and redeploy.
