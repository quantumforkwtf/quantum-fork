import { ArrowRight, Atom, Boxes, ChevronDown, FlaskConical, Network, ScanLine, Volume2, VolumeX } from 'lucide-react'
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GITHUB_REPO, GITHUB_URL, useServerStatus, X_HANDLE, X_URL } from '../config'
import { STATUS_TONE } from '../lab/blueprintVisual'
import { ACCOUNT_MAINNET } from '../lib/evm/account'
import { setSoundEnabled, useSoundEnabled } from '../lib/sound'
import { NET } from '../lib/networkCopy'
import { useToasts } from '../lib/toast'
import { useLocation } from '../navigation'
import { recommendedStatus } from '../protocol/blueprintCompiler'
import { QFORK_MARKET } from '../protocol/base'
import { FEATURED_BLUEPRINTS, type BlueprintStatus } from '../protocol/blueprints'
import { Link } from '../router'
import { replayTour } from '../lib/tour'
import { BuildLink } from './BuildIntents'
import { BaseWalletButton } from './BaseWallet'

const LINKS = [
  { to: '/create', label: 'Create' },
  { to: '/scanner', label: 'Scanner' },
  { to: '/lab', label: 'Lab' },
  { to: '/explore', label: 'Explore' },
  { to: '/network', label: 'Networks' },
  { to: '/species', label: 'Descendants' },
  { to: '/qfork', label: '$QFORK' },
  { to: '/security', label: 'Security', optional: true },
]

const FOOTER_LINKS = [
  {
    title: 'Build',
    links: [
      { to: '/create', label: 'Genesis Studio' },
      { to: '/build', label: 'Help me choose' },
      { to: '/blueprints', label: 'Blueprints' },
      { to: '/account', label: ACCOUNT_MAINNET ? 'Accounts' : 'Accounts (Base Sepolia)' },
      { to: '/lab', label: 'Lab' },
      { to: '/network', label: 'Your networks' },
    ],
  },
  {
    title: 'Explore',
    links: [
      { to: '/explore', label: 'Published configurations' },
      { to: '/lab/reality-fork', label: 'Reality Fork (local)' },
      { to: '/lab/time-machine', label: 'Time Machine (local)' },
      { to: '/lab/fork-wars', label: 'Fork Wars (local)' },
      { to: '/lab/ghost-chains', label: 'Ghost Chains (local)' },
      { to: '/lab/mutation', label: 'Mutation Engine' },
      { to: '/lab/quantum-shield', label: 'Quantum Shield' },
      { to: '/scanner', label: 'Chain scanner' },
      { to: '/quantumize', label: 'App code scanner' },
      { to: '/species', label: 'Descendant tree' },
      { to: '/qfork', label: '$QFORK' },
      { to: '/security', label: 'Threat model' },
    ],
  },
]

let menuStatuses: Map<string, BlueprintStatus> | null = null
const statusOf = (slug: string) => {
  menuStatuses ??= new Map(FEATURED_BLUEPRINTS.map((item) => [item.slug, recommendedStatus(item)]))
  return menuStatuses.get(slug) ?? 'COMING SOON'
}

export function XLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

export function GitHubLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export function GitHubLink({ className = 'icon-btn' }: { className?: string }) {
  return (
    <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className={className} aria-label={`Quantum Fork source on GitHub (${GITHUB_REPO})`} title={`${GITHUB_REPO} on GitHub`}>
      <GitHubLogo />
    </a>
  )
}

export function XLink({ className = 'icon-btn' }: { className?: string }) {
  return (
    <a href={X_URL} target="_blank" rel="noreferrer noopener" className={className} aria-label={`Quantum Fork on X (@${X_HANDLE})`} title={`@${X_HANDLE} on X`}>
      <XLogo />
    </a>
  )
}

/** |ψ⟩, the compact mark: a quantum state written in Dirac notation. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="brand-mark">
      <path d="M5 5V27" stroke="#C8FF4D" strokeWidth={2.6} strokeLinecap="square" />
      <path d="M22.8 5L28.4 16L22.8 27" stroke="#C8FF4D" strokeWidth={2.6} />
      <g stroke="currentColor" strokeWidth={2.8}>
        <path d="M9.6 9.5V14.5a4.6 4.6 0 0 0 9.2 0V9.5" />
        <path d="M14.2 7V25" />
      </g>
    </svg>
  )
}

/** |quantum fork⟩, the wordmark. */
export function Wordmark() {
  return (
    <span className="brand-word">
      <svg className="ket-bar" viewBox="0 0 8 20" fill="none" aria-hidden="true">
        <path d="M2.5 1.5V18.5" stroke="#C8FF4D" strokeWidth={1.8} strokeLinecap="square" />
      </svg>
      quantum fork
      <svg className="ket-angle" viewBox="0 0 10 20" fill="none" aria-hidden="true">
        <path d="M2 1.5L7.6 10L2 18.5" stroke="#C8FF4D" strokeWidth={1.8} />
      </svg>
    </span>
  )
}

function SoundToggle() {
  const on = useSoundEnabled()
  return (
    <button
      type="button"
      className={`icon-btn ${on ? 'is-on' : ''}`}
      aria-pressed={on}
      aria-label={on ? 'Lab sound on' : 'Lab sound off'}
      onClick={() => setSoundEnabled(!on)}
      title="Lab sound effects (off by default)"
    >
      {on ? <Volume2 size={16} strokeWidth={1.7} /> : <VolumeX size={16} strokeWidth={1.7} />}
    </button>
  )
}

/** What the site can actually do right now, according to the server. */
function ModeChip() {
  const server = useServerStatus()
  let label: string
  let title: string
  let live = false
  if (server.state === 'ok') {
    const base = server.status.base
    if (!base?.registration.available) return null
    label = base.network === 'base' ? 'MAINNET' : 'BASE SEPOLIA'
    title = base.network === 'base' ? 'Registration burns real $QFORK on Base, verified on-chain by the server.' : 'Registration burns test QFORK on Base Sepolia, verified on-chain by the server. Test tokens have no value.'
    live = true
  } else if (server.state === 'offline') {
    label = 'OFFLINE'
    title = 'Protocol server unreachable. Designing works; registering and launching tokens do not.'
  } else {
    return null
  }
  return (
    <span className={`status-chip ${live ? 'is-live' : ''}`} title={title}>
      <span className="status-chip-label">{label}</span>
    </span>
  )
}

/** Hidden while scrolling down, back as soon as the reader scrolls up. */
function useNavScroll(pinned: boolean) {
  const [state, setState] = useState({ scrolled: false, hidden: false })
  useEffect(() => {
    let last = window.scrollY
    let frame = 0
    const read = () => {
      frame = 0
      const y = window.scrollY
      const delta = y - last
      last = y
      setState((prev) => {
        const scrolled = y > 8
        let hidden = prev.hidden
        if (y < 240 || delta < -6) hidden = false
        else if (delta > 6) hidden = true
        return prev.scrolled === scrolled && prev.hidden === hidden ? prev : { scrolled, hidden }
      })
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])
  return { scrolled: state.scrolled, hidden: state.hidden && !pinned }
}

/** Compaction steps, cheapest first. Each one sets a `data-fit-*` attribute that base.css acts on. */
const FIT_STEPS = ['cta', 'gh', 'chip', 'brand', 'tight', 'wallet', 'trim'] as const

/**
 * Brand, links and tools sit side by side and must never overlap. Their widths depend on the
 * wallet and server state, so instead of fixed breakpoints this measures and compacts until they fit.
 */
function useNavFit() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const inner = ref.current
    if (!inner || typeof ResizeObserver === 'undefined') return
    const [brand, links, tools] = Array.from(inner.children) as HTMLElement[]
    const fits = () => {
      const style = getComputedStyle(inner)
      const room = inner.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const gap = parseFloat(style.columnGap) || 0
      return brand.offsetWidth + links.offsetWidth + tools.offsetWidth + gap * 2 <= room
    }
    let frame = 0
    const fit = () => {
      frame = 0
      for (const step of FIT_STEPS) inner.removeAttribute(`data-fit-${step}`)
      if (!links.offsetWidth) return
      for (const step of FIT_STEPS) {
        if (fits()) break
        inner.setAttribute(`data-fit-${step}`, '')
      }
    }
    fit()
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit)
    }
    const observer = new ResizeObserver(schedule)
    for (const node of [inner, brand, links, tools]) observer.observe(node)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  return ref
}

/** A highlight that glides to the hovered item and rests on the current page. */
function useIndicator(path: string) {
  const listRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HTMLElement | null>(null)
  const [box, setBox] = useState<{ left: number; width: number; resting: boolean } | null>(null)

  const measure = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const current = list.querySelector<HTMLElement>('[data-nav-item][data-current]')
    const target = hover ?? current
    if (!target) return setBox(null)
    const left = target.getBoundingClientRect().left - list.getBoundingClientRect().left - list.clientLeft
    setBox({ left, width: target.offsetWidth, resting: target === current })
  }, [hover])

  useLayoutEffect(measure, [measure, path])
  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [measure])

  const bind = {
    onPointerOver: (event: ReactPointerEvent) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-nav-item]')
      if (item && item !== hover) setHover(item)
    },
    onPointerLeave: () => setHover(null),
  }
  return { listRef, box, bind }
}

function BuildMenu({ id, onNavigate }: { id: string; onNavigate: () => void }) {
  return (
    <div className="nav-menu" id={id}>
      <div className="nav-menu-list">
        <p className="mono-label">Blueprints · no code required</p>
        <ul>
          {FEATURED_BLUEPRINTS.map((blueprint) => {
            const status = statusOf(blueprint.slug)
            return (
              <li key={blueprint.slug}>
                <Link to={`/blueprints/${blueprint.slug}`} onClick={onNavigate}>
                  <span>
                    <strong>{blueprint.name}</strong>
                    <small>{blueprint.headline}</small>
                  </span>
                  <em style={{ '--tone': STATUS_TONE[status] } as CSSProperties}>{status}</em>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="nav-menu-side">
        <BuildLink className="nav-menu-feature" onClick={onNavigate}>
          <span className="mono-label">No code required</span>
          <strong>What do you want to build?</strong>
          <small>Pick a goal. The blueprint chooses the cryptography.</small>
          <span className="nav-menu-go">
            Start building <ArrowRight size={14} strokeWidth={1.8} />
          </span>
        </BuildLink>
        <Link to="/account" className="nav-menu-link" onClick={onNavigate}>
          Shared accounts and agent wallets <ArrowRight size={13} strokeWidth={1.8} />
        </Link>
        <Link to="/quantumize" className="nav-menu-link" onClick={onNavigate}>
          Scan your app’s code <ArrowRight size={13} strokeWidth={1.8} />
        </Link>
        <Link to="/blueprints" className="nav-menu-link" onClick={onNavigate}>
          All blueprints and statuses <ArrowRight size={13} strokeWidth={1.8} />
        </Link>
        <Link to="/lab?blueprint=custom" className="nav-menu-link" onClick={onNavigate}>
          Expert mode: edit the genome <ArrowRight size={13} strokeWidth={1.8} />
        </Link>
      </div>
    </div>
  )
}

export function Nav() {
  const { path } = useLocation()
  const active = (to: string) => path.startsWith(to)
  const building = active('/blueprints') || active('/build')
  const [open, setOpen] = useState(false)
  const timer = useRef(0)
  const menuWrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const { scrolled, hidden } = useNavScroll(open)
  const { listRef, box, bind } = useIndicator(path)
  const innerRef = useNavFit()

  const close = useCallback(() => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }, [])
  const later = (next: boolean, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(next), ms)
  }

  useEffect(close, [path, close])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      trigger.current?.focus()
    }
    const onDown = (event: PointerEvent) => {
      if (!menuWrap.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, close])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <>
      <header className={`nav ${scrolled ? 'is-scrolled' : ''} ${hidden ? 'is-hidden' : ''}`}>
        <div className="nav-inner" ref={innerRef}>
          <Link to="/" className="brand" aria-label="Quantum Fork home">
            <BrandMark />
            <Wordmark />
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <div className="nav-pill" ref={listRef} {...bind}>
              {box && <span className={`nav-indicator ${box.resting ? 'is-resting' : ''}`} style={{ transform: `translateX(${box.left}px)`, width: box.width }} aria-hidden="true" />}
              <div
                className={`nav-build ${open ? 'is-open' : ''}`}
                ref={menuWrap}
                onPointerEnter={(event) => event.pointerType === 'mouse' && later(true, 90)}
                onPointerLeave={(event) => event.pointerType === 'mouse' && later(false, 180)}
              >
                <button
                  ref={trigger}
                  type="button"
                  className={`nav-item ${building ? 'is-active' : ''}`}
                  data-nav-item=""
                  data-current={building ? '' : undefined}
                  aria-expanded={open}
                  aria-controls="nav-build-menu"
                  onClick={() => (open ? close() : setOpen(true))}
                >
                  Build <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
                </button>
                <BuildMenu id="nav-build-menu" onNavigate={close} />
              </div>
              {LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`nav-item ${active(link.to) ? 'is-active' : ''}`}
                  data-nav-item=""
                  data-current={active(link.to) ? '' : undefined}
                  data-nav-optional={link.optional ? '' : undefined}
                  aria-current={active(link.to) ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>
          <div className="nav-tools">
            <GitHubLink className="icon-btn nav-x nav-gh" />
            <XLink className="icon-btn nav-x" />
            <ModeChip />
            <BaseWalletButton />
            <BuildLink className="btn btn-primary btn-sm nav-cta">Start building</BuildLink>
          </div>
        </div>
      </header>
      <nav className="tabbar" aria-label="Mobile">
        <Link to="/" className={path === '/' ? 'is-active' : ''}>
          <Atom size={19} strokeWidth={1.6} />
          <span>Reactor</span>
        </Link>
        <Link to="/blueprints" className={active('/blueprints') || active('/build') ? 'is-active' : ''}>
          <Boxes size={19} strokeWidth={1.6} />
          <span>Build</span>
        </Link>
        <Link to="/scanner" className={active('/scanner') ? 'is-active' : ''}>
          <ScanLine size={19} strokeWidth={1.6} />
          <span>Scan</span>
        </Link>
        <Link to="/lab" className={active('/lab') ? 'is-active' : ''}>
          <FlaskConical size={19} strokeWidth={1.6} />
          <span>Lab</span>
        </Link>
        <Link to="/species" className={active('/species') ? 'is-active' : ''}>
          <Network size={19} strokeWidth={1.6} />
          <span>Tree</span>
        </Link>
        <Link to="/qfork" className={active('/qfork') ? 'is-active' : ''}>
          <BrandMark size={19} />
          <span>$QFORK</span>
        </Link>
      </nav>
    </>
  )
}

export function Footer() {
  const server = useServerStatus()
  const base = server.state === 'ok' ? server.status.base : undefined
  const baseLive = base?.tokenStatus === 'LIVE' && Boolean(base.token)
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-about">
          <div className="footer-brand">
            <div>
              <p className="footer-title">
                <Wordmark />
              </p>
              <p className="muted">Post-quantum blockchain lab</p>
              <p className="footer-social">
                <a href={X_URL} target="_blank" rel="noreferrer noopener" className="footer-x">
                  <XLogo size={12} /> @{X_HANDLE}
                </a>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="footer-x">
                  <GitHubLogo size={12} /> {GITHUB_REPO}
                </a>
              </p>
            </div>
          </div>
          <div className="footer-copy">
            <p>
              {baseLive
                ? `$QFORK is live on Base: launched on ${QFORK_MARKET.launchpad}, trading on ${QFORK_MARKET.dex}. Descendants are registered by burning $QFORK to 0x…dEaD, verified on-chain by the server${base?.registration.available ? '' : '; registration is not open yet'}. Descendant tokens are real Clanker tokens on Base. No chain runs a descendant yet.`
                : NET.mainnet
                  ? 'Descendants are registered by burning $QFORK on Base, verified on-chain by the server. Their tokens are real Clanker tokens on Base. No chain runs a descendant yet.'
                  : 'Descendants are registered by burning test QFORK, verified on-chain by the server; test tokens have no value. Their tokens are real Clanker tokens on Base. No chain runs a descendant yet, and mainnet registration opens when $QFORK launches.'}
            </p>
            <p>
              Post-quantum here means descendants designed around NIST post-quantum standards; it does not mean quantum-proof.{' '}
              <Link to="/security">Read the threat model</Link>. $QFORK is a {baseLive ? 'utility' : 'not-yet-launched utility'} token, and nothing here
              is investment advice.
            </p>
          </div>
        </div>
        <nav className="footer-nav" aria-label="Footer">
          {FOOTER_LINKS.map((group) => (
            <div key={group.title}>
              <p className="mono-label">{group.title}</p>
              <ul>
                {group.links.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="footer-bottom">
        <p className="footer-label">QUANTUM FORK · POST-QUANTUM BLOCKCHAIN LAB</p>
        <div className="footer-tools">
          <SoundToggle />
          <button type="button" className="btn btn-quiet btn-sm" onClick={replayTour}>
            Replay tour
          </button>
        </div>
      </div>
    </footer>
  )
}

export function Toaster() {
  const toasts = useToasts()
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((item) => (
        <p key={item.id} className="toast">
          <i aria-hidden="true" />
          {item.message}
        </p>
      ))}
    </div>
  )
}
