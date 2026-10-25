import { ArrowRight, X } from 'lucide-react'
import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useRef } from 'react'
import { blueprintVisual } from '../lab/blueprintVisual'
import { closeBuild, intentHref, openBuild, useBuildOpen } from '../lib/build'
import { useLocation } from '../navigation'
import { recommendedStatus } from '../protocol/blueprintCompiler'
import { BLUEPRINT_BY_SLUG, INTENTS } from '../protocol/blueprints'
import { Link } from '../router'
import { BlueprintStatusBadge } from './Blueprint'
import { OrganismThumb } from './Viewports'

export function IntentList({ compact = false, onPick }: { compact?: boolean; onPick?: () => void }) {
  return (
    <ol className={`intents ${compact ? 'is-compact' : ''}`}>
      {INTENTS.map((intent, index) => {
        const blueprint = BLUEPRINT_BY_SLUG[intent.slug]
        const visual = blueprintVisual(blueprint)
        return (
          <li key={intent.id} style={{ '--tone': visual.tone, '--i': index } as CSSProperties}>
            <Link to={intentHref(intent)} className="intent" onClick={onPick}>
              <span className="intent-thumb">
                <OrganismThumb genome={visual.genome} motif={visual.motif} fx={visual.fx} size={compact ? 140 : 200} />
              </span>
              <span className="intent-body">
                <code>{String(index + 1).padStart(2, '0')}</code>
                <strong>{intent.label}</strong>
                <span>{intent.detail}</span>
                <span className="intent-foot">
                  <span className="mono-label">{blueprint.name}</span>
                  <BlueprintStatusBadge status={recommendedStatus(blueprint)} />
                </span>
              </span>
              <ArrowRight className="intent-arrow" size={18} strokeWidth={1.8} aria-hidden="true" />
            </Link>
          </li>
        )
      })}
    </ol>
  )
}

/* ---------- the "Start building" dialog ---------- */

/** A link to /build that opens the intent dialog in place. Modified clicks still open the page. */
export function BuildLink({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.()
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openBuild()
  }
  return (
    <Link to="/build" className={className} onClick={handle}>
      {children}
    </Link>
  )
}

export function BuildDialog() {
  const shown = useBuildOpen()
  const { path } = useLocation()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => closeBuild, [path])

  useEffect(() => {
    if (!shown) return
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closeBuild()
    window.addEventListener('keydown', onKey)
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      root.style.overflow = overflow
      previous?.focus?.()
    }
  }, [shown])

  if (!shown) return null
  return (
    <div className="overlay build-overlay" role="dialog" aria-modal="true" aria-labelledby="build-dialog-title" onClick={(event) => event.target === event.currentTarget && closeBuild()}>
      <div ref={panel} className="build-dialog" tabIndex={-1}>
        <header className="build-dialog-head">
          <div>
            <p className="eyebrow">Start a build · No code required</p>
            <h2 id="build-dialog-title">
              What do you want <span>to build?</span>
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={closeBuild} aria-label="Close">
            <X size={16} strokeWidth={1.8} />
          </button>
        </header>
        <IntentList compact onPick={closeBuild} />
        <p className="build-foot muted">
          Pick the closest match; the blueprint chooses the cryptography. <Link to="/blueprints">Compare every blueprint</Link>.
        </p>
      </div>
    </div>
  )
}
