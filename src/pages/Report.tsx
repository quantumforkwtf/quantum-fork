import { ExternalLink, Microscope, X } from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import GenomeTerminal from '../components/GenomeTerminal'
import ModuleCard from '../components/ModuleCard'
import { OriginBadge, Pill } from '../components/Status'
import { OrganismThumb, SpecimenViewport } from '../components/Viewports'
import { CLIENT_CONFIG, explorerTx, isMainnetNetwork } from '../config'
import type { OrganPart } from '../lab/morphology'
import { ancestorOf, burnChainOf, childrenOf, type Descendant, findDescendant, genomeOf, lineage, ORIGIN_LABEL, updateRemote, useRegistry } from '../lab/registry'
import { useRuntime } from '../lab/runtime'
import { fetchRemoteDeployment } from '../lab/testnet'
import { FlowError } from '../lib/failures'
import { ageOf, formatNumber } from '../lib/hooks'
import { usePageMeta } from '../lib/meta'
import { shortAddress } from '../protocol/address'
import { ANCESTOR_NAME, type AncestorId, DEFAULT_ANCESTOR, exposedParts, LOCUS_BY_CODE, MODELS } from '../protocol/ancestors'
import { type DeploymentRecord, stateLabel } from '../protocol/deployment'
import { ancestorRows, genomeDiff, genomeHash, remainingExposure } from '../protocol/descendant'
import { moduleFor } from '../protocol/modules'
import { CHAIN_BURN_SCALE, PRICING, quoteGenesis } from '../protocol/pricing'
import { PROFILE_BY_ID, strainLabel } from '../protocol/profiles'
import type { BurnReceipt } from '../protocol/receipt'
import { Link } from '../router'
import FailurePanel from '../components/FailurePanel'
import PublicNetwork from '../components/network/PublicNetwork'

function Section({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
  return (
    <section className="report-section" aria-labelledby={`r-${code}`}>
      <header>
        <code>{code}</code>
        <h2 id={`r-${code}`}>{title}</h2>
      </header>
      {children}
    </section>
  )
}

function MicroscopeView({ item, onClose }: { item: Descendant; onClose: () => void }) {
  const [part, setPart] = useState<OrganPart | null>(null)
  const rows = item.config ? genomeDiff(item.config) : ancestorRows()
  const remaining = item.config ? remainingExposure(item.config).map((row) => LOCUS_BY_CODE[row.code].part) : exposedParts()
  const lattice = item.config ? (item.config.modules.some((id) => id === 'hsp' || id === 'lsp') ? 1 : 0.4) : 0
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])
  return (
    <div className="microscope" role="dialog" aria-modal="true" aria-label={`${item.code} under the microscope`}>
      <div className="microscope-stage">
        <SpecimenViewport genome={genomeOf(item)} highlight={part} zoom={1.25} fx={{ exposed: remaining, alert: 0.6, lattice, scan: 0 }} className="microscope-viewport" label={`${item.code} organism, drag to rotate`} />
        <div className="microscope-hud" aria-hidden="true">
          <span>{item.code} · GEN-{item.generation}</span>
          <span>DRAG TO ROTATE · SCROLL TO ZOOM</span>
        </div>
      </div>
      <aside className="microscope-side">
        <header>
          <p className="mono-label">Under the microscope</p>
          <button type="button" className="icon-btn" aria-label="Close microscope" onClick={onClose} autoFocus>
            <X size={16} strokeWidth={1.8} />
          </button>
        </header>
        <ul className="organ-list">
          {rows.map((row) => (
            <li key={row.code}>
              <button
                type="button"
                className={`organ-row ${row.changed ? 'is-changed' : 'is-classical'}`}
                onMouseEnter={() => setPart(LOCUS_BY_CODE[row.code].part)}
                onMouseLeave={() => setPart(null)}
                onFocus={() => setPart(LOCUS_BY_CODE[row.code].part)}
                onBlur={() => setPart(null)}
              >
                <code>{row.code}</code>
                <span>
                  <strong>{row.name}</strong>
                  <small>{row.descendant}</small>
                </span>
                <i>{row.changed ? 'PQ' : 'CLASSICAL'}</i>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

function ReceiptBlock({ receipt }: { receipt: BurnReceipt }) {
  const network = receipt.network
  return (
    <dl className="report">
      <div>
        <dt>Status</dt>
        <dd>
          <Pill label={`BURN ${receipt.verificationStatus}`} tone={receipt.verificationStatus === 'VERIFIED' ? 'var(--green)' : 'var(--orange)'} />
        </dd>
      </div>
      <div>
        <dt>Amount</dt>
        <dd>
          {formatNumber(receipt.amount)} {isMainnetNetwork(network) ? 'QFORK' : 'test QFORK'} ({receipt.amountRaw} base units)
        </dd>
      </div>
      <div>
        <dt>Network</dt>
        <dd>{receipt.network}</dd>
      </div>
      <div>
        <dt>{receipt.chain === 'base' ? 'Transaction' : 'Signature'}</dt>
        <dd>
          <a href={explorerTx(receipt.signature, network)} target="_blank" rel="noreferrer noopener">
            {shortAddress(receipt.signature, 8, 8)} <ExternalLink size={11} strokeWidth={1.8} />
          </a>
        </dd>
      </div>
      <div>
        <dt>Wallet</dt>
        <dd>{shortAddress(receipt.wallet, 6, 6)}</dd>
      </div>
      <div>
        <dt>{receipt.chain === 'base' ? 'Block' : 'Slot'}</dt>
        <dd>{receipt.slot?.toLocaleString('en-US') ?? '—'}</dd>
      </div>
      <div>
        <dt>Verified</dt>
        <dd>{receipt.verifiedAt ? `${receipt.verifiedAt.replace('T', ' ').slice(0, 19)} UTC by server` : '—'}</dd>
      </div>
      <div>
        <dt>Receipt</dt>
        <dd>
          <Link to={`/burn/${receipt.id}`}>{receipt.id.length > 24 ? shortAddress(receipt.id, 8, 8) : receipt.id}</Link>
        </dd>
      </div>
    </dl>
  )
}

function DeploymentBlock({ deployment }: { deployment: DeploymentRecord }) {
  return (
    <>
      <ol className="history">
        {deployment.history.map((entry, index) => (
          <li key={`${entry.state}-${index}`}>
            <time>{entry.at.replace('T', ' ').slice(0, 19)}</time>
            <b>{stateLabel(entry.state, deployment.burn.network)}</b>
            {entry.note && <span>{entry.note}</span>}
          </li>
        ))}
      </ol>
      {deployment.error && <p className="field-error">{deployment.error.message}</p>}
    </>
  )
}

/** Public facts about each ancestor's live network, for its root report. */
const ROOT_FACTS: Record<AncestorId, { label: string; created: string; running: string; operator: string; classical: string }> = {
  base: {
    label: 'Base',
    created: 'Mainnet, August 2023',
    running: 'Base mainnet, running since August 2023.',
    operator: 'The root of the tree. Sequenced by Base and settled on Ethereum, not operated by Quantum Fork.',
    classical: 'None. Base uses classical cryptography: secp256k1 ECDSA signatures, Keccak-256 hashing, and settlement secured by Ethereum’s BLS12-381 validator signatures.',
  },
  solana: {
    label: 'Solana',
    created: 'Mainnet beta, March 2020',
    running: 'Solana mainnet, running since March 2020.',
    operator: 'The root of the tree. Operated by the Solana validator set, not by Quantum Fork.',
    classical: 'None. Solana uses classical cryptography: Ed25519 signatures, SHA-256 and Blake3 hashing, BLS12-381 vote aggregation.',
  },
}

const limitsFor = (origin: Descendant['origin'], ancestor: AncestorId) => (origin === 'ancestor' ? [`This is a model of ${ROOT_FACTS[ancestor].label} compiled from public sources, not a scan of the live network.`, ...LIMITS.ancestor] : LIMITS[origin])

const LIMITS: Record<Descendant['origin'], string[]> = {
  ancestor: [
    'Findings can lag upstream changes; check the model date and sources.',
  ],
  example: ['Example data. This descendant was never registered and is shown only so the explorer is not empty.', 'Its genome is a configuration, not running code.'],
  registered: [
    'Registered by a server-verified burn. On devnet the burned token is a test token with no value.',
    'No chain runs this descendant yet: there are no validators, RPC endpoints or explorer for it.',
    'Post-quantum modules are design specifications; none are implemented.',
  ],
}

export default function Report({ id }: { id: string }) {
  const registry = useRegistry(2000)
  const local = findDescendant(registry, id)
  const [fetched, setFetched] = useState<Descendant | null>(null)
  const [error, setError] = useState<FlowError | null>(null)
  const [microscope, setMicroscope] = useState(false)
  const [hash, setHash] = useState('')
  const [part, setPart] = useState<OrganPart | null>(null)
  const runtime = useRuntime()
  const item = local ?? fetched
  const ancestor = item ? ancestorOf(item) : DEFAULT_ANCESTOR
  const facts = ROOT_FACTS[ancestor]

  usePageMeta({
    title: item ? `${item.code} · ${item.config?.network.name ?? facts.label}` : 'Specimen report',
    description: item ? `${ORIGIN_LABEL[item.origin]} descendant report: genome, post-quantum profile, diff against ${facts.label} and known limitations.` : undefined,
    path: `/species/${id}`,
    image: `/api/og?species=${encodeURIComponent(id)}`,
  })

  useEffect(() => {
    if (!id.startsWith('dep_') || (local && local.deployment)) return
    let cancelled = false
    fetchRemoteDeployment(id)
      .then((data) => {
        if (cancelled) return
        updateRemote(data.deployment, data.receipt, data.tokens)
        if (!local)
          setFetched({
            id,
            code: data.deployment.descendantId,
            origin: 'registered',
            config: data.deployment.config,
            parentId: data.deployment.config.ancestor,
            generation: 1,
            createdAt: data.deployment.createdAt,
            deployment: data.deployment,
            receipt: data.receipt,
            tokens: data.tokens ?? [],
          })
      })
      .catch((caught) => !cancelled && setError(caught instanceof FlowError ? caught : new FlowError('API_UNAVAILABLE')))
    return () => {
      cancelled = true
    }
  }, [id, local])

  useEffect(() => {
    if (!item?.config) return
    let cancelled = false
    void genomeHash(item.config).then((value) => !cancelled && setHash(value))
    return () => {
      cancelled = true
    }
  }, [item?.config])

  const rows = useMemo(() => (item?.config ? genomeDiff(item.config) : ancestorRows(ancestor)), [item?.config, ancestor])

  if (!item) {
    return (
      <div className="page-head not-found">
        <p className="eyebrow">Specimen report</p>
        <h1>{error ? 'Report unavailable.' : id.startsWith('dep_') ? 'Loading specimen…' : 'No such descendant.'}</h1>
        {error && <FailurePanel error={error} />}
        {!id.startsWith('dep_') && <p className="section-lede">Registered descendants have ids that start with dep_.</p>}
        <Link to="/species" className="btn btn-primary">
          Descendant explorer
        </Link>
      </div>
    )
  }

  const config = item.config
  const profile = config ? PROFILE_BY_ID[config.profile] : null
  const chain = lineage(registry, item.id)
  const kids = childrenOf(registry, item.id)
  const burnChain = burnChainOf(item, runtime.burnChain)
  const quote = config ? quoteGenesis(config, 'GENESIS', burnChain) : null
  const remaining = config ? remainingExposure(config) : rows.filter((row) => row.code !== 'HSH')
  const genome = genomeOf(item)
  const name = config?.network.name ?? ANCESTOR_NAME[ancestor]

  return (
    <div className="report-page">
      <header className="report-hero">
        <div className="report-hero-text">
          <p className="eyebrow">
            Specimen report · {item.code} · <OriginBadge origin={item.origin} />
          </p>
          <h1>{name}</h1>
          <p className="result-meta">
            {profile ? strainLabel(profile) : 'CLASSICAL CRYPTOGRAPHY'} · GEN-{item.generation} · {item.origin === 'ancestor' ? 'ROOT ANCESTOR' : `ANCESTOR: ${ANCESTOR_NAME[ancestor]}`}
          </p>
          <div className="result-actions">
            <button type="button" className="btn btn-primary" onClick={() => setMicroscope(true)}>
              <Microscope size={15} strokeWidth={1.8} /> View under microscope
            </button>
            {config && (
              <Link to={`/lab?parent=${item.id}`} className="btn btn-secondary">
                Fork this descendant
              </Link>
            )}
            {item.origin === 'registered' && item.deployment?.state === 'REGISTERED' && (
              <Link to={`/network/${item.id}`} className="btn btn-secondary">
                Console →
              </Link>
            )}
          </div>
        </div>
        <div className="report-hero-org">
          <OrganismThumb genome={genome} size={360} />
        </div>
      </header>

      <div className="report-grid">
        <Section code="01" title="Identity">
          <dl className="report">
            <div>
              <dt>Code</dt>
              <dd>{item.code}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{name}</dd>
            </div>
            {config && (
              <>
                <div>
                  <dt>Symbol</dt>
                  <dd>${config.network.symbol}</dd>
                </div>
                <div>
                  <dt>Network id</dt>
                  <dd>
                    <code>{config.network.networkId}</code>
                  </dd>
                </div>
              </>
            )}
            <div>
              <dt>Origin</dt>
              <dd>{ORIGIN_LABEL[item.origin]}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{item.origin === 'ancestor' ? facts.created : `${item.createdAt.slice(0, 10)} (${ageOf(item.createdAt)})`}</dd>
            </div>
          </dl>
        </Section>

        <Section code="02" title="Ancestry">
          <ol className="ancestry">
            {chain.map((link) => (
              <li key={link.id} className={link.id === item.id ? 'is-self' : ''}>
                {link.id === item.id ? <b>{link.code}</b> : <Link to={`/species/${link.id}`}>{link.code}</Link>}
                <small>{link.config?.network.name ?? ANCESTOR_NAME[ancestorOf(link)]} · GEN-{link.generation}</small>
              </li>
            ))}
          </ol>
        </Section>

        <Section code="03" title="Genome">
          {config ? (
            <ul className="organ-list is-static">
              {rows.map((row) => (
                <li key={row.code} className={`organ-row ${row.changed ? 'is-changed' : 'is-classical'}`}>
                  <code>{row.code}</code>
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.descendant}</small>
                  </span>
                  <i>{row.changed ? 'PQ' : 'CLASSICAL'}</i>
                </li>
              ))}
            </ul>
          ) : (
            <GenomeTerminal ancestor={ancestor} selected={null} onSelect={() => undefined} onHover={setPart} />
          )}
          {part && <span className="sr-only">Highlighting {part}</span>}
          {hash && (
            <p className="hash-line">
              GENOME HASH <code>{hash}</code>
            </p>
          )}
        </Section>

        <Section code="04" title="Post-quantum profile">
          {profile && config ? (
            <>
              <p className="profile-line" style={{ '--tone': profile.color } as CSSProperties}>
                <code>{profile.code}</code> <b>{profile.name}</b> · {profile.summary}
              </p>
              {profile.warning && <p className="callout is-danger">{profile.warning}</p>}
              <div className="pq-grid pq-grid-tight">
                {config.modules.map((moduleId) => (
                  <ModuleCard key={moduleId} module={moduleFor(moduleId, config.ancestor)} scale={CHAIN_BURN_SCALE[burnChain]} />
                ))}
              </div>
            </>
          ) : (
            <p className="muted">{facts.classical}</p>
          )}
        </Section>

        <Section code="05" title={`Diff against ${facts.label}`}>
          <div className="diff" role="table">
            <div className="diff-row diff-head" role="row">
              <span role="columnheader">LOCUS</span>
              <span role="columnheader">{ANCESTOR_NAME[ancestor]}</span>
              <span role="columnheader">{name}</span>
            </div>
            {rows.map((row) => (
              <div key={row.code} className={`diff-row ${row.changed ? 'is-changed' : ''}`} role="row">
                <span role="cell">
                  <code>{row.code}</code> {row.name}
                </span>
                <span role="cell" className="diff-old">
                  {row.ancestor}
                </span>
                <span role="cell" className="diff-new">
                  {row.changed ? '+ ' : '= '}
                  {row.descendant}
                </span>
              </div>
            ))}
          </div>
          <p className="muted">
            {remaining.length} classical {remaining.length === 1 ? 'locus remains' : 'loci remain'}: {remaining.map((row) => row.code).join(', ') || 'none'}.
          </p>
        </Section>

        <Section code="06" title="Status">
          <dl className="report">
            <div>
              <dt>Deployment</dt>
              <dd>{item.origin === 'ancestor' ? 'LIVE NETWORK (EXTERNAL)' : item.origin === 'example' ? 'NOT REGISTERED · EXAMPLE' : item.deployment ? stateLabel(item.deployment.state, item.deployment.burn.network) : 'Loading…'}</dd>
            </div>
            <div>
              <dt>Tier</dt>
              <dd>{config ? config.tier.toUpperCase() : `MAINNET (${ANCESTOR_NAME[ancestor]})`}</dd>
            </div>
            {quote && (
              <div>
                <dt>Registration burn</dt>
                <dd>
                  {formatNumber(quote.total)} QFORK · pricing {PRICING.status.toLowerCase()}
                </dd>
              </div>
            )}
          </dl>
        </Section>

        <Section code="07" title="Registration">
          {item.deployment ? (
            <DeploymentBlock deployment={item.deployment} />
          ) : (
            <p className="muted">{item.origin === 'ancestor' ? facts.operator : 'Never registered. No burn was made for this entry.'}</p>
          )}
        </Section>

        <Section code="08" title="Burn receipt">
          {item.receipt ? <ReceiptBlock receipt={item.receipt} /> : <p className="muted">{item.origin === 'registered' ? 'Waiting for the server receipt…' : 'No burn. Nothing was required or destroyed.'}</p>}
        </Section>

        <Section code="09" title="Running chain">
          <p className="muted">
            {item.origin === 'ancestor'
              ? facts.running
              : 'Not built. Registration records the design and its burn; no chain runs this genome yet.'}
          </p>
        </Section>

        <Section code="10" title="Descendants">
          {kids.length ? (
            <ul className="kid-list">
              {kids.map((kid) => (
                <li key={kid.id}>
                  <Link to={`/species/${kid.id}`}>
                    <b>{kid.code}</b> {kid.config?.network.name}
                  </Link>
                  <OriginBadge origin={kid.origin} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None yet.</p>
          )}
        </Section>

        <Section code="11" title="Source & build">
          <dl className="report">
            <div>
              <dt>Ancestor model</dt>
              <dd>
                {MODELS[ancestor].model.kind} v{MODELS[ancestor].model.version} · {MODELS[ancestor].model.compiled}
              </dd>
            </div>
            <div>
              <dt>Lab build</dt>
              <dd>
                <code>{__BUILD_SHA__}</code> · {__BUILD_TIME__.slice(0, 10)}
              </dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{CLIENT_CONFIG.network}</dd>
            </div>
          </dl>
          <Link to="/security#sources" className="btn btn-quiet btn-sm">
            All sources →
          </Link>
        </Section>

        <Section code="12" title="Security status">
          <p>
            “Post-quantum” here means the design swaps specific classical primitives for NIST-standardised or candidate post-quantum ones. It is not a claim that the network is
            quantum-proof. <Link to="/security">Read the threat model →</Link>
          </p>
        </Section>

        <Section code="13" title="Known limitations">
          <ul className="notes">
            {limitsFor(item.origin, ancestor).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {remaining.length > 0 && <li>Classical dependencies remain at {remaining.map((row) => row.code).join(', ')}.</li>}
          </ul>
        </Section>

        <PublicNetwork item={item} start={14} />
      </div>

      {microscope && <MicroscopeView item={item} onClose={() => setMicroscope(false)} />}
    </div>
  )
}
