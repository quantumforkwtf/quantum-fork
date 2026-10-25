# $QFORK utility design

Status: **design document**. Nothing here deploys a token, changes a token contract or turns on a
payment path. Every change it proposes needs explicit authorization, legal review and the
security review listed in `PRODUCTION_READINESS.md`.

## Principles

1. **No promise of value.** $QFORK is a utility and community token. The product never
   says or implies that it will appreciate, that burns create value for holders, or that holding
   it earns anything.
2. **No hidden mechanics.** No transfer taxes, reflection, rebases, hidden mint authority,
   blacklist or pause functions added by Quantum Fork. The Base token is a standard Clanker v4
   ERC-20 (ERC20Burnable); Clanker's own disclosed LP fee mechanics are described as they are, linked
   to Clanker's documentation, and not presented as rewards.
3. **Every cost is shown before signing**, in token units, with what the burn buys and what it
   does not.
4. **Free paths stay free.** Publishing and anchoring a Chain DNA configuration costs only Base
   gas. The registry has no fee and no token dependency, so the core record of a design never
   requires $QFORK.
5. **Burns are verified by the server from the chain**, never from client reports.

## Current utility (implemented)

| Use | Chain | Mechanism | Status |
| --- | --- | --- | --- |
| Register a descendant | Solana | SPL `BurnChecked` with memo `qfork:v1:genesis:<id>`, verified at finalized commitment | Devnet test QFORK only; mainnet off |
| Register a descendant | Base | ERC-20 `burn(amount)` with a 32-byte deployment tag, verified at a finalized block | Off until the Base token exists and `ENABLE_BASE_DEPLOYMENTS` is set |

Prices are set in `src/protocol/pricing.ts` (Base multiplier ×100), shown before signing, and
labelled provisional.

## Proposed utility (not implemented)

| Use | Why a burn fits | Conditions before building |
| --- | --- | --- |
| Hosted compute credits (Ghost Chains, hosted Reality Fork) | Converts a burn into a bounded, metered allowance (for example environment-hours) with a published rate | The runtime must exist and be priced in real cost first; credits are non-transferable and have no cash value; a non-token payment option must also exist |
| Priority review of a Marketplace module | Spam resistance for a human review queue | Review process and reviewers must exist; burning never guarantees approval |
| Verified listing badge in `/explore` | A visible, costly signal attached to a registry record | Badge must say "burned N $QFORK", nothing more; it is not a safety or quality attestation |

### Explicitly rejected

- Staking for yield, revenue share, buybacks, or "burn to earn".
- Token-weighted governance over infrastructure that holds other people's funds. That needs a
  separate design and review.
- Requiring $QFORK to anchor, export or share a configuration.
- Any mechanic whose explanation depends on the token price.

## Disclosures shown wherever $QFORK is used

- The amount, the chain, and that the tokens are destroyed (sent to no one).
- What the burn records or unlocks, and that it does not deploy a chain.
- On Solana: the token is an SPL token secured by Ed25519. On Base: an ERC-20 secured by
  secp256k1. Neither is quantum-resistant.
- On testnets: test tokens have no value.

## Open questions for the operator

1. Whether to route Base registration prices through Clanker's pool price (volatile) or keep fixed
   token amounts (current design).
2. Whether compute credits should be token-only, or token plus card payments (recommended: both).
3. Legal review of the token's role in each jurisdiction before any paid service launches.
