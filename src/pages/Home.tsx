import { ArrowRight, ScanLine } from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { BlueprintStage, BlueprintStatusBadge, IdealFor } from '../components/Blueprint'
import { BuildLink } from '../components/BuildIntents'
import { GitHubLogo } from '../components/Chrome'
import ExposureMap from '../components/ExposureMap'
import ModuleCard from '../components/ModuleCard'
import { ModuleBadge, OriginBadge, Pill } from '../components/Status'
import { OrganismThumb, ReactorViewport, SpecimenViewport } from '../components/Viewports'
import { GITHUB_URL, useServerStatus } from '../config'
import { blueprintVisual } from '../lab/blueprintVisual'
import { useRuntime } from '../lab/runtime'
import { genomeOf, useRegistry } from '../lab/registry'
import { useScan } from '../lab/useScan'
import { intentHref } from '../lib/build'
import { FINDING_TONE } from '../lib/tones'
import { usePrefersReducedMotion, useSeen, useMediaQuery, wait } from '../lib/hooks'
import { usePageMeta } from '../lib/meta'
import { NET, useRegistrationLabel } from '../lib/networkCopy'
import { ANCESTORS, exposureCounts, FINDINGS, type FindingStatus, LOCI, MODEL } from '../protocol/ancestors'
import { compileBlueprint, recommendedStatus } from '../protocol/blueprintCompiler'
import { QFORK_MARKET } from '../protocol/base'
import { BLUEPRINT_BY_SLUG, FEATURED_BLUEPRINTS, INTENTS } from '../protocol/blueprints'
import { ancestorGenome } from '../protocol/descendant'
import { MODULE_STATUSES, PQ_MODULES } from '../protocol/modules'
import { CHAIN_BURN_SCALE } from '../protocol/pricing'
import { PQ_PROFILES, PROFILE_BY_ID } from '../protocol/profiles'
import { Link } from '../router'
import { type LayerSpec, NO_FX } from '../three/types'

const ANCESTOR = ancestorGenome()

/* ---------- 01 · hero: the build reactor ---------- */

/** What the reactor demonstrates, in order. Each one reshapes the same organism; no extra scenes. */
const HERO_BUILDS = [
  { slug: 'quantum-chain', label: 'Quantum chain', hud: 'QUANTUM CHAIN' },
  { slug: 'quantum-vault', label: 'Quantum vault', hud: 'QUANTUM VAULT' },
  { slug: 'quantum-payments', label: 'Payment network', hud: 'QUANTUM PAYMENTS' },
  { slug: 'private-quantum-network', label: 'Private network', hud: 'PRIVATE NETWORK' },
  { slug: 'quantum-ai-economy', label: 'AI economy', hud: 'AI ECONOMY' },
].map((build) => {
  const blueprint = BLUEPRINT_BY_SLUG[build.slug]
  const intent = INTENTS.find((item) => item.slug === build.slug)
  const config = compileBlueprint(blueprint).config
  return {
    ...build,
    blueprint,
    visual: blueprintVisual(blueprint),
    detail: intent?.detail ?? blueprint.headline,
    href: intent ? intentHref(intent) : `/blueprints/${blueprint.slug}`,
    profile: config ? PROFILE_BY_ID[config.profile].name : null,
    status: recommendedStatus(blueprint),
  }
})

const INTRO_MS = 2600
const BUILD_MS = 4800

function Hero() {
  const ref = useRef<HTMLElement>(null)
  const seen = useSeen(ref)
  const reduced = usePrefersReducedMotion()
  const wide = useMediaQuery('(min-width: 1024px)')
  const [index, setIndex] = useState<number | null>(null)
  const [held, setHeld] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)
  const cycling = seen && !reduced && !held && !pinned

  useEffect(() => {
    if (!cycling) return
    const controller = new AbortController()
    const loop = async () => {
      let next = index
      if (next === null) await wait(INTRO_MS, controller.signal)
      for (;;) {
        next = next === null ? 0 : (next + 1) % HERO_BUILDS.length
        setIndex(next)
        await wait(BUILD_MS, controller.signal)
      }
    }
    loop().catch(() => undefined)
    return () => controller.abort()
    // Resumes from the current build after a hover or focus ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycling])

  const build = index === null ? null : HERO_BUILDS[index]
  const genome = build ? build.visual.genome : ANCESTOR
  const fx = build ? { ...build.visual.fx, lattice: Math.max(build.visual.fx.lattice, 0.35) } : NO_FX

  const preview = (position: number) => {
    setHeld(true)
    setIndex(position)
  }

  return (
    <section ref={ref} className="hero" aria-labelledby="hero-title">
      <div
        className="hero-stage"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        <ReactorViewport genome={genome} phase="idle" framing={wide ? 'right' : 'center'} fx={fx} motif={build?.visual.motif ?? null} softGenome className="hero-canvas" />
        <div className="reactor-hud" aria-hidden="true">
          <span>{build ? `Build ${String((index ?? 0) + 1).padStart(2, '0')} / ${String(HERO_BUILDS.length).padStart(2, '0')} · preview` : 'Quantum Fork'}</span>
          <strong key={build?.slug ?? 'intro'}>{build ? build.hud : 'BUILD REACTOR'}</strong>
        </div>
        <dl className={`reactor-status ${hover ? 'is-shown' : ''}`} aria-label="Reactor status">
          <div>
            <dt>REACTOR STATUS</dt>
            <dd className="is-ok">ONLINE</dd>
          </div>
          <div>
            <dt>BUILD</dt>
            <dd>{build ? build.hud : 'STANDING BY'}</dd>
          </div>
          <div>
            <dt>PQ PROFILE</dt>
            <dd>{build?.profile ?? (build ? 'APPLICATION' : 'UNASSIGNED')}</dd>
          </div>
          <div>
            <dt>BLUEPRINT STATUS</dt>
            <dd>{build ? build.status : '—'}</dd>
          </div>
        </dl>
      </div>
      <div className="hero-inner">
        <div className="hero-copy">
          <h1 id="hero-title">
            Build for the
            <span>quantum future.</span>
          </h1>
          <p className="hero-sub">No code required.</p>
          <p className="hero-lede">
            Launch blockchains, secure digital assets, and build applications with post-quantum cryptography. Choose what you want to build. Quantum Fork handles the complexity.
          </p>
          <div className="hero-ctas">
            <BuildLink className="btn btn-primary btn-lg">
              Start building <ArrowRight size={16} strokeWidth={1.8} />
            </BuildLink>
            <Link to="/blueprints" className="btn btn-secondary btn-lg">
              Explore blueprints
            </Link>
          </div>
        </div>

        <div className="console build-console" onMouseLeave={() => setHeld(false)} onBlur={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setHeld(false)}>
          <div className="console-top">
            <span className="mono-label">
              Build reactor // <b>{build ? (pinned ? 'Selected' : 'Assembling') : 'Ready'}</b>
            </span>
            <span className="tag">Select a blueprint</span>
          </div>
          <ol className="build-picks" aria-label="Example builds">
            {HERO_BUILDS.map((item, position) => (
              <li key={item.slug} style={{ '--tone': item.visual.tone } as CSSProperties}>
                <button
                  type="button"
                  className={position === index ? 'is-on' : ''}
                  aria-pressed={position === index && pinned}
                  onPointerEnter={(event) => event.pointerType === 'mouse' && preview(position)}
                  onFocus={() => preview(position)}
                  onClick={() => {
                    setIndex(position)
                    setPinned(true)
                  }}
                >
                  <i aria-hidden="true" />
                  <code>{String(position + 1).padStart(2, '0')}</code>
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="bc-foot">
            <p role="status" aria-live="polite">
              {build ? (
                <>
                  <b>{build.blueprint.name}.</b> {build.detail}
                </>
              ) : (
                'Pick what to build. The blueprint chooses the cryptography.'
              )}
            </p>
            {build ? (
              <Link to={build.href} className="bc-go">
                Start a build <ArrowRight size={14} strokeWidth={1.8} />
              </Link>
            ) : (
              <BuildLink className="bc-go">
                Start a build <ArrowRight size={14} strokeWidth={1.8} />
              </BuildLink>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- 02 · what will you build ---------- */

function BlueprintSelector() {
  const [active, setActive] = useState(FEATURED_BLUEPRINTS[0])
  const compiled = useMemo(() => compileBlueprint(active), [active])
  const action = compiled.plan.action
  return (
    <section className="section bp-home" aria-labelledby="bp-home-title">
      <header className="section-head section-head-row">
        <div>
          <p className="eyebrow">Blueprints // No code</p>
          <h2 id="bp-home-title">
            What will you <span>build?</span>
          </h2>
        </div>
        <div className="bp-home-intro">
          <p className="section-lede">Start with an idea. Quantum Fork assembles a supported cryptographic and infrastructure blueprint around it.</p>
          <Link to="/blueprints" className="btn btn-secondary">
            Explore blueprints <ArrowRight size={15} strokeWidth={1.8} />
          </Link>
        </div>
      </header>
      <div className="bp-home-grid">
        <ol className="bp-home-list" role="tablist" aria-label="Blueprints" aria-orientation="vertical">
          {FEATURED_BLUEPRINTS.map((blueprint) => {
            const selected = blueprint.slug === active.slug
            return (
              <li key={blueprint.slug} role="presentation">
                <button
                  type="button"
                  role="tab"
                  id={`bp-tab-${blueprint.slug}`}
                  aria-selected={selected}
                  aria-controls="bp-home-panel"
                  className={selected ? 'is-active' : ''}
                  style={{ '--tone': blueprintVisual(blueprint).tone } as CSSProperties}
                  onClick={() => setActive(blueprint)}
                  onPointerEnter={() => setActive(blueprint)}
                  onFocus={() => setActive(blueprint)}
                >
                  <code>{blueprint.index}</code>
                  <strong>{blueprint.name}</strong>
                  <span className="bp-home-kind">{blueprint.category === 'NETWORK' ? 'Network' : 'Application'}</span>
                </button>
              </li>
            )
          })}
        </ol>
        <div className="bp-home-panel panel" id="bp-home-panel" role="tabpanel" aria-labelledby={`bp-tab-${active.slug}`}>
          <BlueprintStage blueprint={active} active className="bp-home-stage" />
          <div className="bp-home-copy" key={active.slug}>
            <div className="bp-home-tags">
              <BlueprintStatusBadge status={compiled.status} />
              <span className="tag">Blueprint // {active.id}</span>
            </div>
            <h3>{active.headline}</h3>
            <p>{active.description}</p>
            <IdealFor items={active.idealFor} />
            <div className="bp-home-actions">
              {action.href ? (
                <Link to={action.href} className="btn btn-primary">
                  {action.label} <ArrowRight size={15} strokeWidth={1.8} />
                </Link>
              ) : null}
              <Link to={`/blueprints/${active.slug}`} className={action.href ? 'btn btn-quiet' : 'btn btn-primary'}>
                Explore {active.name}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- 03 · why ---------- */

const ERA = [
  {
    kicker: 'What breaks',
    title: 'Keys and signatures.',
    body: 'The signatures that prove you own a wallet, and the key exchange that keeps traffic private. A large enough quantum computer could break both.',
    names: 'ED25519 · SECP256K1 · RSA · X25519',
    how: 'Broken by Shor’s algorithm.',
    tone: 'var(--red)',
  },
  {
    kicker: 'What holds',
    title: 'Hashes and ciphers.',
    body: 'Hash functions and symmetric encryption lose some strength to quantum computers. At today’s sizes, they hold.',
    names: 'SHA-256 · AES-256',
    how: 'Weakened, not broken, by Grover’s algorithm.',
    tone: 'var(--cyan)',
  },
  {
    kicker: 'What replaces it',
    title: 'New standards.',
    body: 'NIST published its first post-quantum standards in 2024. Quantum Fork builds around them, usually alongside today’s cryptography rather than instead of it.',
    names: 'ML-KEM · ML-DSA · SLH-DSA',
    how: 'FIPS 203, 204 and 205.',
    tone: 'var(--lime)',
  },
]

function EraSection() {
  return (
    <section className="section era" aria-labelledby="era-title">
      <header className="section-head">
        <p className="eyebrow">Why Quantum Fork</p>
        <h2 id="era-title">
          Built for a different <span>cryptographic era.</span>
        </h2>
        <p className="section-lede">
          Today’s blockchain infrastructure depends on public-key cryptography designed before practical quantum computers. Quantum Fork gives you the tools to experiment with
          post-quantum-oriented architectures, fork them from Base, register them on-chain and launch their tokens.
        </p>
      </header>
      <ol className="era-grid">
        {ERA.map((item, index) => (
          <li key={item.kicker} style={{ '--tone': item.tone } as CSSProperties}>
            <span className="mono-label">
              {String(index + 1).padStart(2, '0')} · {item.kicker}
            </span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
            <details className="era-names">
              <summary>Algorithms</summary>
              <code>{item.names}</code>
              <small>{item.how}</small>
            </details>
          </li>
        ))}
      </ol>
      <p className="era-note">Nobody knows when. Traffic recorded today and keys that can’t rotate are why it matters now.</p>
    </section>
  )
}

/* ---------- 04 · scan the cryptographic DNA ---------- */

const TALLY: FindingStatus[] = ['EXPOSED', 'EXTERNAL DEPENDENCY', 'REVIEWED']

function ScanSection() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeen(ref, '0px 0px -10% 0px')
  const { run, state, revealed } = useScan()
  const counts = useMemo(() => exposureCounts(), [])
  const done = state === 'done'

  useEffect(() => {
    if (seen) run()
  }, [seen, run])

  return (
    <section className="section scan-home" aria-labelledby="scan-home-title">
      <header className="section-head section-head-row">
        <div>
          <p className="eyebrow">Scanner · {MODEL.kind}</p>
          <h2 id="scan-home-title">
            Scan the <span>cryptographic DNA.</span>
          </h2>
        </div>
        <div className="bp-home-intro">
          <p className="section-lede">Every descendant starts from an ancestor. Each of Base’s cryptographic dependencies is mapped, sourced and graded for quantum exposure. Solana is sequenced too.</p>
          <Link to="/scanner" className="btn btn-secondary">
            Open the scanner <ArrowRight size={15} strokeWidth={1.8} />
          </Link>
        </div>
      </header>
      <div ref={ref} className="scan-home-grid">
        <div className={`scan-home-console panel is-${state}`}>
          <p className="scan-home-state" role="status">
            {state === 'scanning' ? `Scanning · locus ${revealed}/${LOCI.length}` : done ? 'Scan complete' : 'Ready'}
          </p>
          <p className="console-name">
            BASE <span>ANCESTOR // GEN-0</span>
          </p>
          <p className="console-sub">
            CLASSICAL CRYPTOGRAPHY · MODEL v{MODEL.version}
          </p>
          <dl className="scan-tally">
            {TALLY.map((status) => (
              <div key={status} style={{ '--tone': FINDING_TONE[status] } as CSSProperties}>
                <dt>{status}</dt>
                <dd>{done ? counts[status] : '—'}</dd>
              </div>
            ))}
          </dl>
          <ol className="scan-home-ancestors" aria-label="Ancestor registry">
            {ANCESTORS.map((ancestor) => (
              <li key={ancestor.id}>
                <code>{ancestor.code}</code> {ancestor.name}
                <Pill label={ancestor.status === 'AVAILABLE' ? 'SEQUENCED' : 'NOT YET SEQUENCED'} tone={ancestor.status === 'AVAILABLE' ? 'var(--lime)' : 'var(--faint)'} />
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-quiet btn-sm" onClick={run} disabled={state === 'scanning'}>
            <ScanLine size={14} strokeWidth={1.8} /> {done ? 'Scan again' : 'Run scan'}
          </button>
        </div>
        <ExposureMap findings={FINDINGS} loci={LOCI} revealed={revealed} />
      </div>
    </section>
  )
}

/* ---------- 06 · choose the evolution ---------- */

function EvolutionSection() {
  const [open, setOpen] = useState(false)
  const scale = CHAIN_BURN_SCALE[useRuntime().burnChain]
  return (
    <section className="section" aria-labelledby="evo-title">
      <header className="section-head">
        <p className="eyebrow">Profiles · Mutations</p>
        <h2 id="evo-title">
          Choose the <span>evolution.</span>
        </h2>
        <p className="section-lede">A profile sets how far a descendant moves from its ancestor. Each one trades compatibility for coverage.</p>
      </header>
      <ol className="evo-profiles">
        {PQ_PROFILES.map((profile) => (
          <li key={profile.id} style={{ '--tone': profile.color } as CSSProperties}>
            <code>{profile.code}</code>
            <strong>{profile.name}</strong>
            <p>{profile.summary}</p>
            <span className="evo-optimizes">
              <span className="mono-label">Optimizes</span> {profile.optimizes}
            </span>
            {profile.warning && <span className="evo-warn">{profile.warning}</span>}
          </li>
        ))}
      </ol>

      <div className="evo-genes">
        <div className="evo-genes-head">
          <p className="mono-label">Gene library · {PQ_MODULES.length} post-quantum modules</p>
          {open && (
            <div className="legend">
              {MODULE_STATUSES.map((item) => (
                <span key={item.status} title={item.meaning}>
                  <ModuleBadge status={item.status} />
                </span>
              ))}
            </div>
          )}
        </div>
        <p className="muted legend-note">The building blocks each profile is made of: signatures, keys, recovery, privacy. Every module is a design specification. None is production code yet.</p>
        {open && (
          <div className="pq-grid" id="gene-grid">
            {PQ_MODULES.map((module) => (
              <ModuleCard key={module.id} module={module} scale={scale} />
            ))}
          </div>
        )}
        <div className="gene-more">
          <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} aria-controls="gene-grid" onClick={() => setOpen(!open)}>
            {open ? 'Hide the modules' : `Show the ${PQ_MODULES.length} modules`}
          </button>
          <Link to="/lab?blueprint=custom" className="btn btn-quiet btn-sm">
            Combine them in Expert Mode <ArrowRight size={13} strokeWidth={1.8} />
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ---------- 07 · burn QFORK, create the descendant ---------- */

const FLOW = [
  { label: 'Select', note: 'Pick a blueprint, or an ancestor in Expert Mode.', color: 'var(--text)' },
  { label: 'Scan', note: 'Every cryptographic dependency of the ancestor, sourced.', color: 'var(--cyan)' },
  { label: 'Configure', note: 'The blueprint sets the genome. Review the exact diff.', color: 'var(--yellow)' },
  { label: 'Burn', note: '$QFORK from your wallet, verified on-chain by the server.', color: 'var(--orange)' },
  { label: 'Register', note: 'The descendant enters the tree with a receipt and a developer kit.', color: 'var(--green)' },
]

function BurnSection() {
  const ref = useRef<HTMLOListElement>(null)
  const seen = useSeen(ref, '-20% 0px')
  const server = useServerStatus()
  const base = server.state === 'ok' ? server.status.base : undefined
  const baseLive = base?.network === 'base' && base.tokenStatus === 'LIVE' && Boolean(base.token)
  return (
    <section className="section" aria-labelledby="flow-title">
      <header className="section-head">
        <p className="eyebrow">$QFORK · {baseLive ? 'Live on Base' : 'Token launch pending'}</p>
        <h2 id="flow-title">
          Burn QFORK. <span>Create the descendant.</span>
        </h2>
        <p className="section-lede">
          Every descendant is registered by burning QFORK, an ERC-20 on Base: it is sent to the burn address 0x…dEaD, which nobody holds a key for, so it can never move again. The server verifies the burn on-chain
          before anything is recorded.
        </p>
      </header>
      <ol ref={ref} className={`lifecycle ${seen ? 'is-seen' : ''}`}>
        {FLOW.map((stage, index) => (
          <li key={stage.label} style={{ '--i': index, '--c': stage.color } as CSSProperties}>
            <span className="lifecycle-node" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <strong>{stage.label}</strong>
            <small>{stage.note}</small>
          </li>
        ))}
      </ol>
      <div className="burn-foot">
        <p className="muted">
          {baseLive
            ? `Launched on ${QFORK_MARKET.launchpad}, trading on ${QFORK_MARKET.dex}. Supply is read from the token contract on Base.`
            : NET.mainnet
              ? 'The token launches on Base. Until it does, there is no price to show.'
              : 'The token has not launched, so there is no price to show. Until then, registration burns a test token with no value.'}
        </p>
        <Link to="/qfork" className="btn btn-secondary btn-sm">
          How $QFORK works <ArrowRight size={14} strokeWidth={1.8} />
        </Link>
      </div>
    </section>
  )
}

/* ---------- 08 · after registration ---------- */

interface BeginningStage {
  title: string
  body: string
  status: string
  tone: string
  system: string | null
  adds: LayerSpec[]
}

const BEGINNING: BeginningStage[] = [
  {
    title: 'Register',
    body: 'Burn $QFORK. The server verifies the burn on-chain and registers the descendant: a permanent record, a receipt and a public page.',
    status: NET.mainnet ? NET.registration : 'LAUNCHING SOON',
    tone: 'var(--lime)',
    system: null,
    adds: [],
  },
  {
    title: 'Launch its token',
    body: 'A Clanker token on Base. Created from your wallet, and recorded once the server reads it from the chain.',
    status: 'AVAILABLE',
    tone: 'var(--green)',
    system: 'Tokens',
    adds: [
      { key: 'orbit:a', kind: 'orbit', seed: 11, index: 0 },
      { key: 'orbit:b', kind: 'orbit', seed: 29, index: 1 },
    ],
  },
  {
    title: 'Connect developers',
    body: 'A manifest, an env template and an SDK config pointing at the real chain and the real token contracts, with Foundry commands that work today. No keys are ever generated.',
    status: 'AVAILABLE',
    tone: 'var(--green)',
    system: 'Developers',
    adds: [{ key: 'membrane', kind: 'membrane', seed: 0, index: 0, activity: 0.6 }],
  },
  {
    title: 'Fork it',
    body: 'A child inherits the genome. Change what you need and register it with its own burn; it joins the tree under its parent.',
    status: 'AVAILABLE',
    tone: 'var(--green)',
    system: 'Forks',
    adds: [{ key: 'bud:0', kind: 'bud', seed: 83, index: 0 }],
  },
  {
    title: 'Run its own chain',
    body: 'Operators run a Base descendant as a QBFT network on their own machines with the node kit: validators, consensus and a read-only RPC. It is a standard EVM chain; the genome’s post-quantum modules are not part of it.',
    status: 'OPERATOR-RUN',
    tone: 'var(--green)',
    system: 'Nodes',
    adds: [],
  },
]

const BEGINNING_LAYERS = BEGINNING.map((_, index) => BEGINNING.slice(0, index + 1).flatMap((stage) => stage.adds))
const BEGINNING_SYSTEMS = BEGINNING.filter((stage) => stage.system)

function BeginningSection() {
  const section = useRef<HTMLElement>(null)
  const steps = useRef<(HTMLLIElement | null)[]>([])
  const near = useSeen(section, '400px')
  const [active, setActive] = useState(0)
  const visual = useMemo(() => blueprintVisual(BLUEPRINT_BY_SLUG['quantum-chain']), [])
  const registration = useRegistrationLabel()

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index))
      },
      { rootMargin: '-62% 0px -33% 0px' },
    )
    for (const step of steps.current) if (step) observer.observe(step)
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={section} className="section beginning" aria-labelledby="beginning-title">
      <header className="section-head">
        <p className="eyebrow">After registration</p>
        <h2 id="beginning-title">
          Your descendant <span>is the beginning.</span>
        </h2>
        <p className="section-lede">Registering creates the record. What you launch on it is real.</p>
      </header>
      <div className="beg">
        <div className="beg-stage">
          {near && <SpecimenViewport genome={visual.genome} fx={visual.fx} layers={BEGINNING_LAYERS[active]} zoom={0.92} interactive={false} className="beg-view" label="A descendant organism gaining structures as tokens and forks are added" />}
          <ul className="beg-systems" aria-hidden="true">
            {BEGINNING_SYSTEMS.map((stage, index) => (
              <li key={stage.system} className={`at-${index} ${BEGINNING.indexOf(stage) <= active ? 'is-on' : ''}`}>
                <code>{stage.system}</code>
                <small>{stage.status}</small>
              </li>
            ))}
          </ul>
          <p className="beg-caption">
            <code>{String(active + 1).padStart(2, '0')}</code> {BEGINNING[active].title}
          </p>
        </div>
        <ol className="beg-steps">
          {BEGINNING.map((stage, index) => (
            <li
              key={stage.title}
              ref={(node) => {
                steps.current[index] = node
              }}
              data-index={index}
              className={index === active ? 'is-on' : index < active ? 'is-past' : ''}
            >
              <code>{String(index + 1).padStart(2, '0')}</code>
              <h3>{stage.title}</h3>
              <p>{stage.body}</p>
              <Pill label={index === 0 && NET.mainnet ? registration : stage.status} tone={stage.tone} />
            </li>
          ))}
        </ol>
      </div>
      <div className="beg-foot">
        <Link to="/lab?blueprint=quantum-chain" className="btn btn-primary">
          Design a descendant <ArrowRight size={15} strokeWidth={1.8} />
        </Link>
        <Link to="/network" className="btn btn-secondary">
          Your descendants
        </Link>
        <p className="muted">Everything on this list is real. A descendant’s chain runs only where its operators run it; Quantum Fork hosts none.</p>
      </div>
    </section>
  )
}

/* ---------- 08 · descendants ---------- */

function DescendantTeaser() {
  const all = useRegistry()
  const featured = useMemo(() => all.filter((item) => item.origin !== 'ancestor').slice(-4).reverse(), [all])
  return (
    <section className="section" aria-labelledby="teaser-title">
      <header className="section-head section-head-row">
        <div>
          <p className="eyebrow">Descendant tree · rooted at Base</p>
          <h2 id="teaser-title">Descendants.</h2>
        </div>
        <Link to="/species" className="btn btn-secondary">
          Open the tree <ArrowRight size={15} strokeWidth={1.8} />
        </Link>
      </header>
      <div className="specimen-grid">
        {featured.map((item) => (
          <Link key={item.id} to={`/species/${item.id}`} className="specimen-card">
            <span className="sc-stage">
              <OrganismThumb genome={genomeOf(item)} size={220} />
            </span>
            <span className="sc-body">
              <span className="sc-code">
                {item.code} · GEN-{item.generation}
              </span>
              <strong className="sc-title">{item.config?.network.name}</strong>
              <OriginBadge origin={item.origin} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default function Home() {
  usePageMeta({ path: '/' })
  return (
    <>
      <Hero />
      <BlueprintSelector />
      <BeginningSection />
      <EraSection />
      <ScanSection />
      <EvolutionSection />
      <BurnSection />
      <DescendantTeaser />
      <FinalWord />
    </>
  )
}

export function FinalWord() {
  return (
    <section className="final-word" aria-label="Closing statement">
      <p className="final-big">Start a build.</p>
      <p className="final-chant">
        <span>Choose.</span> <span>Configure.</span> <span>Burn.</span> <span>Launch.</span>
      </p>
      <div className="final-actions">
        <BuildLink className="btn btn-primary btn-lg">
          Start building <ArrowRight size={16} strokeWidth={1.8} />
        </BuildLink>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="btn btn-secondary btn-lg">
          <GitHubLogo size={15} /> Read the source
        </a>
      </div>
    </section>
  )
}
