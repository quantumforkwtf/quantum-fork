import type { CSSProperties } from 'react'
import SourceList from '../components/SourceList'
import { ModuleBadge } from '../components/Status'
import { CLIENT_CONFIG, useServerStatus } from '../config'
import { usePageMeta } from '../lib/meta'
import { NET } from '../lib/networkCopy'
import { PQ_MODULES } from '../protocol/modules'
import { type SourceId, SOURCES } from '../protocol/sources'

const THREATS: { threat: string; impact: string; mitigation: string; status: 'MITIGATED' | 'PARTIAL' | 'OPEN' }[] = [
  {
    threat: 'A malicious or compromised wallet changes the burn transaction',
    impact: 'Funds sent somewhere else instead of burned',
    mitigation: 'The lab requests exactly one call, token.burn(amount) with the deployment tag and no ETH, after re-checking chain state. A changed call is never credited. A compromised wallet can still sign anything, so check the call in your wallet.',
    status: 'PARTIAL',
  },
  {
    threat: 'A client claims a burn that never happened',
    impact: 'Deployment granted for free',
    mitigation: 'The server ignores client-reported amounts, wallets and success. It reads the transaction and receipt from its own Base RPC, waits for a finalized block, and checks the token contract, the transfer to the burn address, amount, tag and sender.',
    status: 'MITIGATED',
  },
  {
    threat: 'One burn is credited twice, or to two deployments',
    impact: 'Double entitlement',
    mitigation: 'Each signature is bound to one deployment with an atomic lock; receipts are written once; deployment creation is idempotent per key.',
    status: 'MITIGATED',
  },
  {
    threat: 'A transfer to a wallet someone controls is presented as a burn',
    impact: 'Tokens recoverable; burn not real',
    mitigation: '$QFORK has no burn() function, so a burn is a direct transfer to 0x000000000000000000000000000000000000dEaD, an address nobody holds a key for. The receipt must show exactly one Transfer of that amount from the wallet to that address; transfers anywhere else fail verification. Burned tokens can never move again, but they still count in totalSupply().',
    status: 'MITIGATED',
  },
  {
    threat: 'Cross-site request forgery or scripted abuse of the API',
    impact: 'Spam deployments, storage exhaustion',
    mitigation: 'Origin allowlist on writes, JSON-only bodies, 16 KB size limit, strict schemas, per-IP rate limits.',
    status: 'PARTIAL',
  },
  {
    threat: 'Phishing site imitating Quantum Fork',
    impact: 'Users sign a draining transaction elsewhere',
    mitigation: 'The lab never asks for a seed phrase or private key. Users must still check the domain and the exact transaction in their wallet.',
    status: 'OPEN',
  },
  {
    threat: 'RPC provider outage or incorrect data',
    impact: 'Burns delayed or mis-verified',
    mitigation: 'Server verification waits for a finalized Base block. Outages fail closed with “safe to retry”; a sent burn resumes after reload.',
    status: 'PARTIAL',
  },
  {
    threat: 'A future quantum computer recovers secp256k1 keys',
    impact: 'Base accounts, including those holding QFORK, can be spent',
    mitigation: 'None inside this app. $QFORK is an ERC-20 on Base, held by secp256k1 (ECDSA) accounts like every Base asset. Descendant designs address this; the lab does not.',
    status: 'OPEN',
  },
]

const STATUS_TONE = { MITIGATED: 'var(--green)', PARTIAL: 'var(--yellow)', OPEN: 'var(--red)' }

const PROTECTIONS = [
  'No private keys, seed phrases or secrets are requested, stored or transmitted. Your browser wallet signs locally, connected over EIP-6963.',
  'Every irreversible action has a review screen with the exact call, contract, amount in base units, gas estimate and dry-run result.',
  'Transactions are dry-run against Base before signing; a failed dry run is never sent.',
  'Burn credit requires server verification in a finalized Base block. “BURN VERIFIED” is shown only after it.',
  'Dangerous capabilities (real burns, registration, token launches, experimental modules) are off unless explicitly enabled on the server.',
  'Token launches are recorded only after the server reads the token and its creation transaction from the chain and matches the creator to the descendant’s burn wallet.',
  'Server logs are structured, carry correlation ids, and redact secrets, tokens and full addresses.',
  'Security headers: no framing, no MIME sniffing, strict referrer policy, restricted browser permissions.',
]

const CLASSICAL = [
  { what: '$QFORK and every Base wallet', why: 'secp256k1 (ECDSA) signatures. The burn you sign is classical.' },
  { what: 'Browser ↔ server TLS', why: 'Depends on your browser and the host; hybrid ML-KEM is not guaranteed.' },
  { what: 'RPC providers and explorers', why: 'Third-party infrastructure with classical authentication.' },
  { what: 'Wallet software', why: 'Derives secp256k1 keys (BIP-32). No mainstream Ethereum wallet uses PQ keys.' },
  { what: 'Bridges and oracles', why: 'Attestations are classical unless the bridge itself migrates.' },
  { what: 'Hashes (SHA-256, Blake3)', why: 'Grover gives a quadratic speed-up only; 256-bit hashes keep a large margin.' },
]

const ASSUMPTIONS = [
  'NIST FIPS 203/204/205 parameter sets remain unbroken. FIPS 206 (FN-DSA) is not final.',
  'The Base and Solana ancestor models reflect public sources as of their compile date; upstream changes can make findings stale.',
  'Server storage (Upstash Redis) is available and not tampered with. Without it, registration is disabled.',
  'The configured RPC returns correct finalized data.',
]

const LIMITATIONS = [
  'Quantum Fork hosts no descendant chains. A Base descendant runs only where operators run the node kit: a standard EVM chain (Besu, QBFT) with classical secp256k1 keys, without the genome’s post-quantum modules. Solana descendants have no chain.',
  'The node directory lists what operators sign. It does not check uptime or vouch for operators, and the site never relays node traffic.',
  ...(NET.mainnet ? [] : ['Devnet registration burns a test token with no value. Devnet tokens launched for a descendant have no value either.']),
  'Post-quantum modules are design specifications, not shipped code.',
  'The scanner is a curated model, not automated analysis of a codebase.',
  'Rate limiting is per IP and fails open if storage is unreachable.',
]

export default function Security() {
  usePageMeta({ title: 'Security', description: 'Threat model, protections, assumptions and limitations of Quantum Fork.', path: '/security' })
  const server = useServerStatus()
  const flags = server.state === 'ok' ? server.status.flags : CLIENT_CONFIG.flags
  const base = server.state === 'ok' ? server.status.base : undefined
  const experimental = PQ_MODULES.filter((module) => module.status !== 'PRODUCTION')

  return (
    <div className="security-page">
      <header className="page-head">
        <p className="eyebrow">Security · Threat model v1</p>
        <h1>What protects you, and what doesn’t.</h1>
        <div className="audit-banner panel">
          <p>
            <b>No outside security review has been done yet.</b>
          </p>
        </div>
      </header>

      <section className="section section-split" aria-labelledby="pq-title">
        <header className="section-head">
          <p className="eyebrow">Definitions</p>
          <h2 id="pq-title">What “post-quantum” means here.</h2>
        </header>
        <div className="prose">
          <p>
            A descendant replaces specific classical primitives (Ed25519 signatures, curve-based key exchange, BLS aggregation) with NIST-standardised or candidate post-quantum
            primitives such as ML-DSA, SLH-DSA and ML-KEM.
          </p>
          <p>
            That makes a design <b>post-quantum oriented</b>. It does not make it quantum-proof. Swapping the signature scheme alone leaves addresses, wallets, consensus, bridges,
            RPC and TLS classical. Every remaining dependency is listed on each specimen report.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="threat-title">
        <header className="section-head">
          <p className="eyebrow">Threat model</p>
          <h2 id="threat-title">Threats, impact, mitigation.</h2>
        </header>
        <div className="threats" role="table">
          {THREATS.map((row) => (
            <article key={row.threat} className="threat" role="row" style={{ '--tone': STATUS_TONE[row.status] } as CSSProperties}>
              <h3 role="cell">{row.threat}</h3>
              <p role="cell" className="threat-impact">
                {row.impact}
              </p>
              <p role="cell">{row.mitigation}</p>
              <span role="cell" className="badge" style={{ '--tone': STATUS_TONE[row.status] } as CSSProperties}>
                <i aria-hidden="true" />
                {row.status}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="section split-section" aria-label="Protections and classical dependencies">
        <div>
          <p className="eyebrow">Protections in place</p>
          <ul className="notes">
            {PROTECTIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow">Classical dependencies that remain</p>
          <dl className="report">
            {CLASSICAL.map((row) => (
              <div key={row.what}>
                <dt>{row.what}</dt>
                <dd>{row.why}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="section" aria-labelledby="flags-title">
        <header className="section-head">
          <p className="eyebrow">This deployment</p>
          <h2 id="flags-title">Capability switches.</h2>
        </header>
        <dl className="flag-grid">
          {(
            [
              ['BASE_TOKEN_STATUS = LIVE', base?.tokenStatus === 'LIVE'],
              ['BASE_REGISTRATION', Boolean(base?.registration.available)],
              ['ENABLE_CLANKER_LAUNCH', Boolean(base?.clankerLaunch)],
              ['ENABLE_SCANNER', flags.scanner],
              ['ENABLE_EXPERIMENTAL_PQ', flags.experimentalPq],
            ] as const
          ).map(([name, on]) => (
            <div key={name} className={on ? 'is-on' : ''}>
              <dt>{name}</dt>
              <dd>{on ? 'ON' : 'OFF'}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">
          Network: {base?.network === 'base-sepolia' ? 'Base Sepolia' : 'Base'}. {server.state === 'ok' ? 'Values read from the server. Registration also needs a live token and durable storage.' : 'Server unreachable; showing build-time values.'}
        </p>
      </section>

      <section className="section" aria-labelledby="exp-title">
        <header className="section-head">
          <p className="eyebrow">Experimental</p>
          <h2 id="exp-title">Designs, not production code.</h2>
        </header>
        <ul className="exp-list">
          {experimental.map((module) => (
            <li key={module.id}>
              <code>{module.code}</code>
              <span>
                <b>{module.name}</b> · {module.primitive}
              </span>
              <ModuleBadge status={module.status} />
            </li>
          ))}
        </ul>
      </section>

      <section className="section split-section" aria-label="Assumptions and limitations">
        <div>
          <p className="eyebrow">Assumptions</p>
          <ul className="notes">
            {ASSUMPTIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow">Known limitations</p>
          <ul className="notes">
            {LIMITATIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" id="sources" aria-labelledby="sources-title">
        <header className="section-head">
          <p className="eyebrow">Sources · {SOURCES.length}</p>
          <h2 id="sources-title">Everything we cite.</h2>
          <p className="section-lede">Standards, proposals and research behind every finding and module. Drafts and closed proposals are marked.</p>
        </header>
        <SourceList ids={SOURCES.map((source) => source.id as SourceId)} />
      </section>

      <section className="section" aria-labelledby="disclose-title">
        <header className="section-head">
          <p className="eyebrow">Disclosure</p>
          <h2 id="disclose-title">Found something?</h2>
        </header>
        <p className="prose">
          Do not test against other users’ funds. Report issues through the project’s official channels; a dedicated security contact and disclosure policy will be published
          before any mainnet capability is enabled.
        </p>
      </section>
    </div>
  )
}
