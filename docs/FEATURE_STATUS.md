# Feature status

As of 2026-10-25, branch `base`. Statuses:

- **Implemented**: works, and its acceptance tests pass against the real component named in the evidence.
- **Partially implemented**: the code path exists and is tested, but part of the acceptance criteria is unmet.
- **Planned**: designed in [`IMPLEMENTATION_ROADMAP.md`](./IMPLEMENTATION_ROADMAP.md), not built.
- **Blocked**: cannot proceed without something outside the repository (stated).

No outside security review has been done on any of it.

## Implemented

| Feature | Evidence |
| --- | --- |
| Chain DNA v1 schema, support matrix, validation, readiness, hashing (`src/protocol/chainDna.ts`) | `tests/chainDna.test.ts` (17 tests) |
| Genome glyph derived from the configuration (`src/lab/dnaGlyph.ts`) | `tests/chainDna.test.ts`: renaming keeps the glyph, support colours reflect the target |
| Anvil command generation for local devnets | `tests/anvil.test.ts` boots Anvil 1.7.1 with the generated flags and reads back chain ID, gas limit, P-256 and BLS12-381 precompiles |
| Genesis Studio `/create`: three targets, per-option support labels, disabled impossible options, validation, export/import/share, local library, compare | `.recording/studio.mjs` browser checks (desktop + mobile, no console errors) |
| QForkRegistry contract (`contracts/src/QForkRegistry.sol`) | `forge test`: 21 tests, including 3 fuzz tests at 1024 runs |
| Configuration publishing `POST /api/configs` (server-side normalisation, validation, hashing, write-once, idempotent, refuses memory storage) | `tests/anvil.test.ts` |
| Anchor verification (finalized block, chain, contract, sender, event, kind, one tx per anchor) | `tests/anvil.test.ts` against a real Anvil node with the compiled registry: PENDING → VERIFIED, idempotent, five rejection cases |
| Reality Fork `/lab/reality-fork` (local): two Anvil forks of one Base block, identity checked against the real block hash, modifications on one fork, the same impersonated transactions on both, compared receipts, call trees and state diffs, snapshot/revert so reruns match | `tests/realityFork.test.ts` (12 tests, real Anvil forks); `.recording/reality-fork.mjs` (12 browser checks against two real forks of Base Sepolia) |
| Time Machine `/lab/time-machine` (local): parent-block fork, ordered replay of earlier transactions in the same block (including Base deposits), receipt comparison (status, gas, logs), impersonated calldata/value/gas edits, snapshot revert | `tests/timeMachine.test.ts`: a local three-transaction block (storage after the middle transaction is the middle value, not the final one) and Base Sepolia block 49873286 index 2 (status, gas, logs and block number match) |
| Fork Wars `/lab/fork-wars` (local): two fresh Anvil processes, fixed workloads (ERC-20, ERC-721, deploy, storage, compute, mixed), measured gas, wall-clock latency, throughput, failure rate, and `ps` RSS/CPU of the Anvil process. `POST /api/benchmarks` refuses to start Anvil unless the server is a local dev process | `tests/forkWars.test.ts`; `contracts/test/Workloads.t.sol` |
| Ghost Chains `/lab/ghost-chains` (local): create a temporary Anvil on 127.0.0.1 with a 15m, 1h, 6h or 24h lifetime, unique chain id, loopback RPC, block height, recent transaction count, RSS, accounts and logs read from that process; snapshot via `anvil_dumpState`; terminate kills the process. Two at a time. Forgotten when the dev server stops | `tests/ghostChain.test.ts` |
| Mutation Engine `/lab/mutation`: versioned Chain DNA lineages in this browser, alternative branches, full parent history, and a plan that classifies each change as a contract, a local Anvil setting, a dedicated chain, research, or impossible. Base consensus, block time, gas limit, base fee and the EVM are classified impossible to change by contract. Recording a branch does not deploy it | `tests/mutation.test.ts` |
| Quantum Shield `/lab/quantum-shield` (browser part): ML-DSA-44/65/87 and SLH-DSA-SHA2-128f/128s from `@noble/post-quantum`, ECDSA secp256k1 and P-256 baselines, measured key/signature sizes and timings on the user's device, EIP-2028 calldata cost, sign/verify/tamper playground | `tests/pqSignatures.test.ts` (44 tests, including NIST ACVP key generation and signature verification vectors); `.recording/quantum-shield.mjs` (10 browser checks) |
| Explorer `/explore` and `/explore/:hash` (published configurations only, honest empty and no-storage states) | `.recording/studio.mjs` |
| Solana scanner, lab, descendant explorer, specimen reports, security page | See `PRODUCTION_READINESS.md` |
| Server-side burn verification (Solana, finalized) | `tests/protocol.test.ts`, `tests/burnflow.test.ts`; devnet run end to end with a script-held wallet |

## Partially implemented

| Feature | Done | Missing |
| --- | --- | --- |
| Anchoring from the studio with a browser wallet | Client flow (estimate, review, sign, read-back check, poll verification) | Not run with a real wallet, because the registry is not deployed on Base Sepolia (see Blocked) |
| Base registration burns (ERC-20 `burn` + deployment tag) | Server verification at a finalized block, client encoding, chain switching | Not run on Base Sepolia or Base; needs a Base `$QFORK` token address |
| Clanker v4 token launch for descendants | Server builds calldata, user wallet sends, server verifies from the receipt | Not run on Base; behind `ENABLE_CLANKER_LAUNCH` (off) |
| Solana devnet registration via browser wallets | Full pipeline | Not run with Phantom, Solflare or Backpack |
| Pump.fun launches | Built and tested with fixtures | Not run on mainnet |

## Planned

| Feature | Phase | Note |
| --- | --- | --- |
| Quantum Shield onchain part: ML-DSA verifier contract with gas measured on Anvil, ERC-4337 post-quantum validator | 4 | `@noble/post-quantum` is not independently audited; a verifier needs outside cryptographic review before holding value |
| Privacy Lab `/lab/privacy` (real proof system and verifier contract) | 5 | No simulated proofs |
| Dashboard `/dashboard`, docs hub `/docs` | 2–3 | |
| Marketplace, Chain Autopilot, adapters, billing, SDKs | 6 | Need auth and isolated execution |
| `$QFORK` utility as described in [`QFORK_TOKEN_UTILITY.md`](./QFORK_TOKEN_UTILITY.md) | — | Design only; no token is deployed by this work |

## Blocked

| Feature | Blocker | What exists meanwhile |
| --- | --- | --- |
| QForkRegistry on Base Sepolia | A dedicated testnet-only deployer exists (`0xac178aeF8777CA828936FF6101e38D951975Aa98`, key in the gitignored `.keys/`) but holds no Base Sepolia ETH. Every faucet that sends Base Sepolia ETH needs a signed-in account | `contracts/script/Deploy.s.sol` (refuses mainnet by default); Anvil end-to-end test |
| QForkRegistry on Base mainnet | Explicit authorization required, after Sepolia | — |
| Hosted Ghost Chains | No isolated container runtime, authenticated RPC gateway or budget | Local Ghost Chains run Anvil on 127.0.0.1 with a TTL and a two-environment quota |
| Hosted Reality Fork | Same runtime | Local Reality Fork works today with Anvil on the user's machine |
| Dedicated OP Stack rollup provisioning | Needs an operator for sequencer, batcher, proposer and settlement contracts, plus funded L1/L2 accounts | The studio lists every component and marks provisioning BLOCKED |
| `/cloud` | Same runtime | — |
| Execution-client and consensus mutations | Need a custom client; not possible on Base | Shown as NOT POSSIBLE on Base and NEEDS INFRASTRUCTURE on a rollup |
