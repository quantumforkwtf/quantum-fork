# Production readiness

Build: Vite 6 + React 18 + TypeScript (strict), three.js, Vercel Functions, Upstash Redis.
Review status: no outside security review has been done.

Nothing on the site is simulated. What it does:

1. Design a descendant genome in the lab.
2. Register it by burning QFORK. Today that is devnet test QFORK (no value), handed out by a
   rate-limited faucet; the server verifies the burn on-chain and records the descendant.
3. Launch real tokens for it from the owner's wallet: an SPL token on the site's cluster, or
   a Pump.fun token on mainnet (real SOL). The server records a token only after reading its
   creation transaction and mint account from the chain.

What does not exist is shown as not built: a descendant's own chain, validators, RPC and
explorer.

Labels used across the product: **AVAILABLE**, **DEVNET** (real devnet transaction, test
token with no value), **TESTNET** (blueprint status: can be registered on devnet),
**EXPERIMENTAL**, **RESEARCH**, **COMING SOON**.

Verification legend in this document:
- *verified*: exercised end to end in this pass (browser QA and/or automated tests).
- *tested*: covered by unit tests with mocked RPC/storage, not run against a live network.
- *unverified*: implemented but not exercised.

---

## IMPLEMENTED

| Area | What works | Evidence |
| --- | --- | --- |
| Positioning and labels | "Fork today's chains. Rewrite their cryptography."; Solana = ANCESTOR 001; others NOT YET SEQUENCED; AVAILABLE/DEVNET/TESTNET/EXPERIMENTAL/RESEARCH/COMING SOON labels; header mode chip reads DEVNET, MAINNET, READ-ONLY or OFFLINE from `/api/status` | verified |
| Hero | Reactor card with status cycle (ANCESTOR LOADED → SCANNING → DEPENDENCIES FOUND → EXPOSURE DETECTED → PQ MIGRATION AVAILABLE), hover status panel, CTAs | verified (desktop + mobile) |
| Scanner `/scanner` | Manual desk review of Solana, 18 findings with status, impact, source; Quantum Exposure Map; status tallies; filter chips; "NOT AN AUDIT" | verified |
| DNA section | Genome table (SIG/KEY/HSH/TXA/VAL/WLT/BRG/RCV/PRF/EXT), row hover highlights the organ, click opens terminal detail | verified |
| Gene library and profiles | PQ modules with standard, size, complexity, status, UNAUDITED; HYBRID, PQ FORWARD, RESEARCH (NOT FOR PRODUCTION ASSETS), CUSTOM | verified |
| Lab `/lab` | Stations from ancestor to Register; gating (scan required, validation, tier availability); persisted draft; `?profile=` and `?parent=` forks; exact-requirement quote; diff against Solana with remaining classical loci; devnet faucet at the wallet step; review of the exact burn; hold-to-confirm; reveal "DESCENDANT REGISTERED" only after server verification; next actions: launch its token, developer kit, console | built; devnet run pending (see PARTIALLY IMPLEMENTED) |
| Honest stage labels | The state machine ends at REGISTERED (DRAFT → VALIDATED → AWAITING_BURN → BURN_SUBMITTED → BURN_CONFIRMED → REGISTERED). No label mentions genesis, provisioning, validators or "online"; the result card shows "Running chain: Not built" | unit test |
| Explorer `/species` | Tree rooted at Solana, origin filters with counts, lineage highlight, inspector, compare (locus diff), pan/zoom, mobile outline, "N VERIFIED ON DEVNET · 0 ON MAINNET" | verified (desktop) |
| Specimen report `/species/:id` | sections incl. ancestry, genome + hash, PQ profile, diff, status, registration history, burn receipt, running chain (not built), descendants, tokens, build SHA, security status, known limitations; full-screen microscope | verified |
| Receipts `/burn/:id` | Looked up on the server by signature. "BURN VERIFIED" renders only for `verificationStatus=VERIFIED` and `verifier=server`; devnet receipts say TEST QFORK | tested |
| `/qfork` (prelaunch) | TOKEN LAUNCH PENDING, disabled CTA, "No price. No chart. Not yet.", reactions with labels, plain-terms facts, audit UNAUDITED | verified |
| `/security` | UNAUDITED banner, definition of post-quantum oriented, threat table, capability switches from the server, limitations, sources, disclosure | verified |
| Burn verification (server) | Finalized-commitment fetch from server RPC; checks BurnChecked, mint, raw amount, decimals, owner, memo `qfork:v1:genesis:<id>`, success; rejects transfers and memo mismatches | tested (`tests/protocol.test.ts`, `tests/burnflow.test.ts`) |
| Replay protection | Atomic signature lock, write-once receipts, idempotent deployment creation, state-machine transition guards | tested |
| Transaction safety (client) | Hand-serialised ComputeBudget + BurnChecked + Memo, dry run first, `signTransaction` only, `TX_MODIFIED` byte comparison before broadcast, pending burn persisted and resumed on reload | tested (serialisation); unverified with a real wallet |
| Configuration | Central config resolver; mint set in one place; inconsistent settings resolve to the safer value with a reported issue; mainnet forced off | tested |
| Feature flags | `ENABLE_REAL_BURNS`, `ENABLE_TESTNET_DEPLOYMENTS`, `ENABLE_MAINNET_DEPLOYMENTS`, `ENABLE_PUMPFUN_DATA`, `ENABLE_EXPERIMENTAL_PQ` default false; `ENABLE_SCANNER` default true | tested |
| Storage durability gate | Testnet tier refused unless Redis is configured (`persistent: true`) | verified (UI shows reason) |
| API hardening | Origin allowlist on writes, JSON-only, 16 KB limit, schema validation, per-IP rate limits, security headers + CSP, HSTS | tested / config |
| SEO | Title, description, canonical, OG/Twitter tags, manifest, favicon, robots (disallows `/api/`), sitemap; per-page meta for `/species/:id` and `/burn/:id` via `/api/page`; dynamic 1200×630 cards via `/api/og` | verified locally |
| Observability | Structured JSON logs with correlation ids and redaction; client reports (error, unhandledrejection, error boundary, wallet, WebGL) capped at 10 per page | verified (WebGL context-loss report received) |
| WebGL failure handling | No WebGL, engine chunk failure, scene init failure or context loss → all viewports switch to the dark 2D organism | verified (forced context loss) |
| Motion and accessibility | Motion tiers (150 / 220 / 400 / 1200 ms; cinematic only for scan, burn, genesis); `prefers-reduced-motion` makes the scan instant and clamps transitions; keyboard hold-to-confirm; ARIA labels on viewports, dialogs, radiogroups | verified (reduced motion) |
| Mobile compositions | Hero text first; full-screen scanner stage; lab with floating specimen, one station, sticky step nav above the tab bar; burn review as a bottom sheet | verified except the burn sheet (testnet only) |
| Failure UX | Each flow error states what happened, whether funds moved, whether QFORK burned, whether retry is safe, and the next step | tested (mapping); partially verified |
| Sound | Off by default, never autoplays | verified |

### Chain DNA and the Base registry

| Area | What works | Evidence |
| --- | --- | --- |
| Chain DNA v1 | Strict schema; per-target support (built in, your contracts, needs infrastructure, research, not possible); Base-fixed values locked; validation errors and warnings; readiness and infrastructure inventory without invented numbers; canonical keccak256 hash | unit tests (`tests/chainDna.test.ts`) |
| Genesis Studio `/create` | Three targets with "not an independent chain" stated for Base and Anvil; impossible options disabled; export, import, share link, local library, compare; generated Anvil command | verified (`.recording/studio.mjs`); Anvil flags verified by booting Anvil (`tests/anvil.test.ts`) |
| Publishing | `POST /api/configs` normalises, validates and hashes server-side; write-once; refuses memory storage | tested against real Anvil |
| QForkRegistry | Ownerless, fee-free, non-upgradeable hash registry; deploy script refuses mainnet by default | `forge test` (21 tests, fuzzed) |
| Anchor verification | Reads the registration at a finalized block; checks chain, contract, sender, event and kind; one transaction per anchor | end to end against real Anvil with the compiled contract. **Not deployed on Base Sepolia yet** (needs the operator's funded key) |
| Explorer `/explore` | Lists only published configurations and verified anchors | verified |
| Quantum Shield `/lab/quantum-shield` | Browser benchmarks and playground for ML-DSA / SLH-DSA with ECDSA baselines; no onchain verifier. States that Base does not become quantum-resistant and that `@noble/post-quantum` is not independently audited | tested (NIST ACVP vectors); verified in the browser |
| Reality Fork `/lab/reality-fork` | Local only: the browser drives two user-run Anvil forks over loopback (CSP allows `http://127.0.0.1:*` and `http://localhost:*` for this); fork identity checked against the real block hash; deterministic, reverting runs | tested against real Anvil forks; verified in the browser against two forks of Base Sepolia. On the live site, browsers may ask permission to reach the local network |
| Time Machine `/lab/time-machine` | Local only: reads one Base transaction from the public RPC, forks the parent block, resubmits preceding transactions in order (including Base deposits), then compares the receipt. Calldata, value and gas edits are impersonated and reverted. Blob and 7702 types are refused | `tests/timeMachine.test.ts` against a local Anvil block and a pinned Base Sepolia transaction |
| Fork Wars `/lab/fork-wars` | Local only: `POST /api/benchmarks` starts two loopback Anvil processes when the server is not production and not Vercel, runs a fixed contract workload, samples RSS and CPU with `ps`, then kills the processes. One run at a time, two runs a minute | `tests/forkWars.test.ts` |
| Ghost Chains `/lab/ghost-chains` | Local only: `POST /api/ghosts` starts Anvil on 127.0.0.1 when the server is not production and not Vercel. TTL, two-environment quota, snapshot, kill on terminate. Not a hosted isolated runtime | `tests/ghostChain.test.ts` |
| Mutation Engine `/lab/mutation` | Browser-only lineages. Plans classify contract changes separately from Base consensus and from dedicated-chain infrastructure. No deployment | `tests/mutation.test.ts` |

### After registration

| Area | What works | Evidence |
| --- | --- | --- |
| SPL token launch | Owner wallet only (the burn receipt's wallet). Name, symbol, description, supply, decimals, optional fixed supply. One transaction, wallet is the only signer: CreateAccountWithSeed (mint address derived from the wallet), InitializeMint2 (no freeze authority), associated token account, MintToChecked, Metaplex CreateMetadataAccountV3 (immutable), optional SetAuthority(MintTokens → none), memo `qfork:v1:token:<deploymentId>`. Dry run before signing; refused if the wallet altered it | tested: encoders match `@solana/spl-token` and `web3.js` byte for byte; server flow with mocked RPC |
| Pump.fun token launch | Mainnet only, behind `ENABLE_PUMPFUN_LAUNCH` and an explicit "spends real SOL" acknowledgement. PumpPortal `trade-local` builds the create transaction; the server checks it is paid by the owner, signed by the mint and calls the Pump program before returning it. The mint keypair is generated in the browser and held in memory only; the wallet signs first, then the mint co-signs the same message. The server relays to mainnet. Metadata JSON is served from `/api/tokens?meta=<mint>` (pump.fun's IPFS endpoint is no longer offered) | tested (co-signing against web3.js, server checks); **not run on mainnet** |
| Token verification | The server reads the creation transaction (confirmed) and the mint account: fee payer = owner, mint initialized in that transaction with the owner as authority (SPL) or mint signed and Pump program called (Pump.fun), memo binds the descendant. Name and symbol come from Metaplex metadata or the Token-2022 extension. Recorded write-once; at most 12 per descendant | tested |
| Devnet faucet | `POST /api/faucet`: 1,000,000 test QFORK (plus 0.1 devnet SOL when the wallet is low), signed server-side by the test mint's authority (`QFORK_FAUCET_KEYPAIR`, never `VITE_`). Refused on mainnet, without storage, or if the key is not the mint authority. Once per wallet per 24 h, 3 per IP per day | tested (signature verified with web3.js) |
| Descendant console `/network/:id` | Metrics from records only (registered, QFORK burned, tokens, forks, cluster, running chain: Not built); tabs Overview, Tokens, Developers, Cryptography; Launch a token for the owner | built |
| Developer kit | `descendant.json`, `.env.example` and `qfork.config.ts` pointing at the real cluster RPC and the real mints; quickstart with Solana CLI commands that work against those mints; checked for key material before download | unit test |
| Public profile | `/species/:id` lists the descendant's verified tokens with explorer and pump.fun links | built |
| Homepage | "Your descendant is the beginning." Register (DEVNET), Launch its token, Connect developers, Fork it (AVAILABLE), Run its own chain (COMING SOON) | built |

## PARTIALLY IMPLEMENTED

| Area | State | Missing |
| --- | --- | --- |
| Devnet registration | Full pipeline built: create deployment → prepare exact burn → dry run → sign → send → confirm → server verify → receipt → REGISTERED | **Not run end to end against devnet with a real wallet yet.** Needs Redis, the devnet test mint, the faucet key and the flags (see MANUAL CONFIGURATION REQUIRED). Covered by unit tests with mocked RPC. |
| Token launches | SPL and Pump.fun paths built and tested as above | SPL not yet run on devnet; Pump.fun not yet run on mainnet. |
| Wallet | wallet-standard discovery, connect, network detection, SOL/QFORK balances, sign, error mapping | Not exercised with Phantom/Solflare/Backpack in this pass. No mobile deep-link wallet flow. |
| Pump.fun adapter | Reads mint info and bonding-curve account directly from chain; trading link; handles curve completion | Cannot be verified until the token exists. Post-migration (AMM) pricing is not implemented; it reports `complete` without a price. |
| Explorer pan/zoom | Drag pan, Ctrl/⌘+wheel zoom, buttons, reset | No pinch-zoom on touch; mobile uses a list outline instead. |
| Protocol stats on `/qfork` | Counted only from server-verified receipts | Zero until real verified burns exist. |
| API abuse resistance | Rate limits and origin checks | No captcha or proof-of-work; rate limits are per IP only. |
| CSP | `script-src 'self'` | `style-src` still allows `'unsafe-inline'`. |
| Scanner coverage | Solana, manual desk review v0.1.0 | Not an automated source scan. Other ancestors not sequenced. |

## NOT IMPLEMENTED

- **A running chain for any descendant.** No validators, RPC, WebSocket, explorer or genesis block exist for descendants, on any cluster. The site says so wherever a descendant appears.
- **Mainnet registration** until `$QFORK` launches. The code path exists (real burn, verified the same way) and stays off unless explicitly configured.
- **Fork reaction (RX-2) and module install (RX-3).** Forks can be designed and registered as new descendants; burning to install a module is COMING SOON.
- **Any post-quantum module implementation.** All modules are specifications.
- Apps, vaults, payments, agent wallets, NFTs, governance and multisig on descendants. Removed rather than simulated.
- Additional ancestors (Ethereum, Cosmos, Bitcoin, Sui): NOT YET SEQUENCED.
- Price charts and holder counts (intentionally absent until LIVE, and not built).
- Security contact or bug-bounty programme (the disclosure section invents none).

## EXPERIMENTAL

- RESEARCH profile (lattice-only signatures, PQ privacy). Labelled NOT FOR PRODUCTION ASSETS.
- Modules with status RESEARCH or EXPERIMENTAL in the gene library.
- `ENABLE_EXPERIMENTAL_PQ` flag (off).
- 3D organism morphology: a visual model of a genome, not a measurement.

## SECURITY REVIEW REQUIRED

Before any real-value burn:

1. Burn verification (`src/protocol/verifyBurn.ts`, `api/_lib/deployments.ts`): instruction parsing for Token and Token-2022, inner instructions, memo binding, amount/decimals checks.
2. Client transaction construction (`src/lib/solana/tx.ts`, `burn.ts`, `launch.ts`): serialisation, `TX_MODIFIED` comparison, dry-run handling, Pump.fun co-signing.
3. Token launch verification (`src/protocol/tokens.ts`, `api/_lib/tokens.ts`) and the PumpPortal response check.
4. Faucet key handling and rate limits (`api/_lib/faucet.ts`).
5. Replay and idempotency under concurrency (Redis lock semantics, retries, partial failures).
6. API surface: origin checks, rate limits, schema validation, error messages that could leak state.
7. CSP and third-party origins (`connect-src https: wss:` is broad).
8. Logging redaction.
9. Pump.fun bonding-curve decoding against the live program layout.
10. Every PQ module specification, by a cryptographer, before anyone implements one.

## MANUAL CONFIGURATION REQUIRED

- Vercel project env vars (Production and Preview) per `.env.example`.
- Upstash Redis (Vercel KV integration) → `KV_REST_API_URL`, `KV_REST_API_TOKEN`.
- Dedicated Solana RPC provider for the server (`SOLANA_RPC_URL`), and optionally for the client.
- Devnet test QFORK mint, created with a dedicated devnet authority (never a mainnet key). That authority's keypair goes in `QFORK_FAUCET_KEYPAIR` (server only), and the authority needs devnet SOL (faucet.solana.com) to pay faucet fees.
- Devnet flags on both sides: `SOLANA_NETWORK=devnet`, `QFORK_MINT`, `ENABLE_REAL_BURNS=true`, `ENABLE_TESTNET_DEPLOYMENTS=true` (and `VITE_` equivalents).
- Optional: `ENABLE_PUMPFUN_LAUNCH=true` (both) to let owners create Pump.fun tokens; `MAINNET_RPC_URL` for a dedicated mainnet endpoint.
- `SITE_URL` / `VITE_SITE_URL` once a custom domain exists; update `public/sitemap.xml`, `robots.txt` and the absolute URLs in `index.html`.
- After launch: `QFORK_MINT`, `TOKEN_STATUS=LIVE`, optionally `PUMPFUN_URL`.

## ENVIRONMENT VARIABLES

| Server | Client (public) | Default | Notes |
| --- | --- | --- | --- |
| `SOLANA_NETWORK` | `VITE_SOLANA_NETWORK` | `devnet` | `devnet`, `testnet`, `mainnet-beta` |
| `SOLANA_RPC_URL` | `VITE_SOLANA_RPC_URL` | public endpoint | https only; the server key may hold an API key |
| `QFORK_MINT` | `VITE_QFORK_MINT` | empty | the only place the mint is configured |
| `TOKEN_STATUS` | `VITE_TOKEN_STATUS` | `PRELAUNCH` | `LIVE` requires a valid mint |
| `PUMPFUN_URL` | `VITE_PUMPFUN_URL` | empty | must be `https://pump.fun/…` |
| `SITE_URL` | `VITE_SITE_URL` | `https://quantumfork.wtf` | canonical and OG URLs |
| `ENABLE_SCANNER` | `VITE_ENABLE_SCANNER` | `true` | |
| `ENABLE_REAL_BURNS` | `VITE_ENABLE_REAL_BURNS` | `false` | needs a mint; on mainnet also `TOKEN_STATUS=LIVE` |
| `ENABLE_TESTNET_DEPLOYMENTS` | `VITE_ENABLE_TESTNET_DEPLOYMENTS` | `false` | forced off on mainnet |
| `ENABLE_MAINNET_DEPLOYMENTS` | `VITE_ENABLE_MAINNET_DEPLOYMENTS` | `false` | mainnet registration; needs `mainnet-beta`, LIVE, the mint and real burns |
| `ENABLE_PUMPFUN_DATA` | `VITE_ENABLE_PUMPFUN_DATA` | `false` | mainnet only |
| `ENABLE_EXPERIMENTAL_PQ` | `VITE_ENABLE_EXPERIMENTAL_PQ` | `false` | |
| `ENABLE_PUMPFUN_LAUNCH` | `VITE_ENABLE_PUMPFUN_LAUNCH` | `false` | Pump.fun token creation for descendant owners (real SOL, mainnet) |
| `MAINNET_RPC_URL` | — | public mainnet | relay and verification for Pump.fun launches |
| `QFORK_FAUCET_KEYPAIR` | — | empty | secret; 64-byte JSON array of the devnet test mint's authority; ignored on mainnet |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | — | empty | also accepts `UPSTASH_REDIS_REST_*` |
| `ALLOWED_ORIGINS` | — | empty | extra POST origins; `SITE_URL` and Vercel URLs always allowed |
| `LOG_LEVEL` | — | `info` | |
| `BASE_NETWORK` | — | `base-sepolia` | `base-sepolia` or `base` |
| `BASE_RPC_URL` | — | public endpoint | https only; `http://127.0.0.1:<port>` accepted only in local development |
| `QFORK_BASE_TOKEN`, `BASE_TOKEN_STATUS` | — | empty, `PRELAUNCH` | Base `$QFORK`; `LIVE` needs the address |
| `ENABLE_BASE_DEPLOYMENTS` | — | `false` | Base registration burns |
| `ENABLE_CLANKER_LAUNCH` | — | `false` | descendant Clanker v4 launches |
| `QFORK_REGISTRY_ADDRESS` | — | empty | QForkRegistry on `BASE_NETWORK`; blank turns anchoring off |

Server-only variables never use the `VITE_` prefix (the Vite equivalent of `NEXT_PUBLIC_`).

## TOKEN LAUNCH CHECKLIST

1. Launch `$QFORK` on Pump.fun; record the mint address from the transaction, not from a screenshot.
2. Confirm on an explorer: token program, decimals, supply, mint authority, freeze authority.
3. Set `QFORK_MINT` and `VITE_QFORK_MINT` to the same value; set `TOKEN_STATUS=LIVE` on both.
4. Set `SOLANA_NETWORK=mainnet-beta` and a dedicated `SOLANA_RPC_URL`.
5. Optionally `ENABLE_PUMPFUN_DATA=true` (both), then check `/qfork` shows supply, authorities and curve data with a source line.
6. Keep `ENABLE_MAINNET_DEPLOYMENTS` false until the MAINNET CHECKLIST is done. Launching the token does not enable mainnet registration. Remove `QFORK_FAUCET_KEYPAIR` (it is ignored on mainnet anyway).
7. Redeploy (client values are build-time); check `/api/status` and the mode chip.
8. Re-check that no page shows a price, market cap or holder count from anywhere except the chain.

## MAINNET CHECKLIST

Mainnet registration burns real `$QFORK`. Keep it off until:

1. Independent security review of everything under SECURITY REVIEW REQUIRED.
2. Successful devnet registrations and SPL launches end to end with at least Phantom, Solflare and Backpack, including rejected, failed, duplicate and refresh-mid-flow cases.
3. Redis in production with backups; replay tests under concurrency.
4. Dedicated RPC with failover; alerting on verification failures and log anomalies.
5. Terms and legal review of the token's role. Registration records a design; it does not provision a chain, and the site must keep saying so.
6. Security contact published.

## KNOWN RISKS

- **Unaudited code handles wallet signatures.** The transaction-safety checks are tested but not reviewed.
- **Single RPC provider** for verification; a wrong or stale response is not cross-checked.
- **Devnet pipeline run end to end only with a script-held wallet** (`.recording/devnet-e2e.mjs`: faucet, deployment, BurnChecked + memo, server verification at finalized commitment, idempotent resubmit, signature reuse refused; first registration QF-0001). Not yet run through the browser with Phantom, Solflare or Backpack. Pump.fun launches not yet run on mainnet.
- **Pump.fun launches depend on PumpPortal**, a third party that builds the transaction. The server checks payer, mint signer and program before the wallet sees it, and the wallet shows the final transaction, but PumpPortal's instructions are not decoded field by field.
- **Phishing clones** cannot be prevented by the app.
- **Quantum exposure of `$QFORK` itself.** It is a Solana SPL token secured by Ed25519.
- **Scanner findings are a manual review** and can be incomplete or outdated; each finding cites its source.
- **Registrations are records, not chains.** A registered descendant is a server record bound to an on-chain burn. Anyone reading "descendant" as a running network would be wrong; every surface states that no chain runs it yet.
- **A registry anchor is a record, not a deployment.** It proves an address published a hash on Base; it says nothing about safety, and nothing runs because of it.
- **Visual organism is illustrative.** It reflects the configuration, not any security property.
- **Pricing of reactions is provisional.**
