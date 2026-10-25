# Quantum Fork threat model

Status: **draft, unaudited**. Nothing in this repository has been independently reviewed.
The public summary of this document is the `/security` page; keep the two in step.

There are two systems with different threat models:

1. **The site and its burn pipeline**: real code that handles real wallets and, on
   devnet, real token burns.
2. **Descendant designs**: specifications exported by the lab. They are not
   implemented and run nowhere.

---

## Part 1 — Site and burn pipeline

### Assets

- Users' wallets and their QFORK balance.
- Registration: the record that a descendant was paid for by a verified burn, and who owns it.
- Token launches: only a descendant's owner may launch its tokens, and only on-chain facts are recorded.
- The devnet faucet authority key (test mint only).
- Integrity of burn receipts and of the "verified" label.
- Server credentials: RPC API keys, Redis token, faucet keypair.

### Trust boundaries

| Component | Trusted for |
| --- | --- |
| Browser and wallet | Nothing the server relies on. Amount, wallet address, success and deployment state reported by the client are ignored. |
| Vercel functions (`/api`) | Building quotes, verifying burns, writing receipts, advancing deployment state. |
| Solana RPC (server's own endpoint) | Finalized transaction data. A single provider; see open risks. |
| Upstash Redis | Durable receipts, signature locks, idempotency keys, rate-limit counters. |

### Threats and mitigations

| Threat | Impact | Mitigation | Status |
| --- | --- | --- | --- |
| Wallet or extension injects instructions into the burn transaction | Funds drained in the same signature | The client serialises the transaction itself (ComputeBudget, BurnChecked, Memo), requests `signTransaction` only, and refuses to broadcast if the signed message bytes differ (`TX_MODIFIED`). | Mitigated |
| Client claims a burn that never happened | Free entitlement | Server fetches the transaction at **finalized** commitment from its own RPC and checks program, instruction (BurnChecked only), mint, raw amount, decimals, owner/signer, memo `qfork:v1:genesis:<deploymentId>`, and absence of failure. | Mitigated |
| Replay: one signature credited twice or to two deployments | Double entitlement | Atomic signature lock in Redis; receipts written once; deployment creation idempotent per `Idempotency-Key`; state machine rejects out-of-order transitions. | Mitigated |
| Transfer to a "dead" wallet presented as a burn | Supply not reduced | Transfers fail verification. Only `BurnChecked` reduces supply. | Mitigated |
| Non-durable storage loses a receipt on cold start | Replay after restart | Registration, token launches and the faucet are refused unless storage is persistent (`persistent: true`). | Mitigated |
| CSRF / scripted abuse of the API | Spam deployments, storage exhaustion | Origin allowlist on writes, JSON-only bodies, 16 KB body limit, strict schema validation, per-IP rate limits (deploy 10/min, burn 30/min, log 20/min, reads 120/min). No captcha or proof-of-work. | Partial |
| XSS or injected script | Wallet prompts from attacker code | `script-src 'self'` CSP, no inline scripts, `frame-ancestors 'none'`, server-rendered meta tags HTML-escaped. `style-src` still allows `'unsafe-inline'`. | Partial |
| Phishing clone of the site | User signs a draining transaction elsewhere | The app never asks for seed phrases or private keys. Nothing technical prevents a clone. | Open |
| RPC outage or incorrect data | Burn delayed or mis-verified | Fail closed with "safe to retry"; signed-but-unverified burns are persisted locally and resumed on reload. Single RPC provider, no cross-check. | Partial |
| Secrets leak into the bundle | Credential theft | Server variables have no `VITE_` prefix and are read only in `/api`. Logs redact signatures and never include tokens or env values. | Mitigated |
| Mainnet enabled by accident | Real QFORK burned before launch or by misconfiguration | Mainnet registration needs `SOLANA_NETWORK=mainnet-beta`, `TOKEN_STATUS=LIVE`, the mint, `ENABLE_REAL_BURNS` and `ENABLE_MAINNET_DEPLOYMENTS`; any missing value resolves to off. Deploying does not enable it. | Mitigated |
| Someone launches tokens for a descendant they do not own | Impersonation | Prepare requires the burn receipt's wallet; verification requires that wallet to be the fee payer and (SPL) the mint authority, read from the chain. Client-reported success is ignored. | Mitigated |
| PumpPortal returns a malicious transaction | Wallet drained | Server checks fee payer, mint signer and Pump program before returning it; the wallet must sign the exact bytes and the client refuses any change; explicit real-SOL acknowledgement. Instructions are not decoded field by field. | Partial |
| Faucet key leaks or is abused | Test QFORK minted freely | Key is server-only, controls only a devnet test mint, ignored on mainnet; once per wallet per 24 h and 3 per IP per day. Test tokens have no value. | Mitigated |
| Quantum adversary recovers Ed25519 keys | Solana accounts, including QFORK holders, spendable | None. `$QFORK` lives on Solana. | Open |

### Logging rules

Never logged: private information, full wallet signatures, secrets, tokens, environment
credentials. Client error reports are capped at 10 per page load, truncated, and carry no
wallet data or transaction bytes.

---

## Part 2 — Descendant designs

### Security objective

Preserve authorization, transaction privacy, consensus integrity and recovery through a
staged migration from classical signatures to standardised post-quantum signatures.

A design that replaces signature schemes is **post-quantum oriented**, not quantum-proof.
Adding ML-DSA alone does not make a chain quantum-resistant: addresses, key derivation,
consensus aggregation, bridges, wallets, RPC/TLS and recovery paths must all migrate.
Every specimen report lists the classical dependencies that remain.

### Threats considered

1. **Harvest now, forge later.** Public keys and signatures recorded today are forged once
   a cryptographically relevant quantum computer exists.
2. **Downgrade during migration.** Nodes or wallets accept the weaker half of a hybrid policy.
3. **Key-recovery deadlock.** Dormant accounts cannot rotate away from a deprecated suite.
4. **Consensus split.** Incompatible activation rules make validators disagree on valid suites.
5. **Privacy regression.** Migration metadata, larger proofs or recovery operations add linkability.
6. **Resource exhaustion.** Larger keys and signatures raise block, bandwidth, storage and
   verification costs.

### Required invariants

- A hybrid account requires both configured signatures; either alone is invalid.
- Suite identifiers are domain-separated and committed inside the signed payload.
- Activation and deprecation heights are deterministic consensus parameters.
- Recovery cannot silently weaken the active account-signature policy.
- Historical verification rules remain available after a suite is deprecated.
- Privacy and recovery paths get the same migration review as ordinary authorization.

### Outside scope

- Cryptographic implementations and constant-time behaviour.
- Zero-knowledge proving systems and trusted setup.
- Networking, validator key management, denial-of-service limits.
- Randomness, bridges, light clients, data availability.
- Formal verification, external review, production deployment.

Exported configurations are design metadata only. No module has a reference
implementation, and none is audited.
