import { type CSSProperties, type KeyboardEvent, useId } from 'react'
import { type AncestorId, type CategoryCode, DEFAULT_ANCESTOR, findingsFor, type GenomeLocus, locusStatus, MODELS } from '../protocol/ancestors'
import type { OrganPart } from '../lab/morphology'
import { FINDING_TONE } from '../lib/tones'
import { FindingBadge } from './Status'
import SourceList from './SourceList'

interface GenomeTerminalProps {
  selected: CategoryCode | null
  onSelect: (code: CategoryCode | null) => void
  onHover: (part: OrganPart | null) => void
  loci?: GenomeLocus[]
  ancestor?: AncestorId
  /** When false, rows show "—" until a scan has revealed them. */
  revealed?: boolean
}

/** Dense locus table with a detail pane, read like a market terminal. */
export default function GenomeTerminal({ selected, onSelect, onHover, ancestor = DEFAULT_ANCESTOR, loci = MODELS[ancestor].loci, revealed = true }: GenomeTerminalProps) {
  const id = useId()
  const active = loci.find((locus) => locus.code === selected) ?? null

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = loci.findIndex((locus) => locus.code === selected)
    const next = loci[(index + (event.key === 'ArrowDown' ? 1 : -1) + loci.length) % loci.length]
    onSelect(next.code)
    onHover(next.part)
    requestAnimationFrame(() => document.getElementById(`${id}-${next.code}`)?.focus())
  }

  return (
    <div className={`terminal ${active ? 'has-detail' : ''}`}>
      <div className="terminal-table" role="listbox" aria-label="Genome loci" aria-activedescendant={selected ? `${id}-${selected}` : undefined} onKeyDown={onKeyDown}>
        <div className="terminal-row terminal-headrow" aria-hidden="true">
          <span>LOCUS</span>
          <span>SYSTEM</span>
          <span>FINDINGS</span>
          <span>STATUS</span>
        </div>
        {loci.map((locus) => {
          const status = locusStatus(locus.code, ancestor)
          const isActive = locus.code === selected
          return (
            <button
              key={locus.code}
              id={`${id}-${locus.code}`}
              type="button"
              role="option"
              aria-selected={isActive}
              className={`terminal-row ${isActive ? 'is-active' : ''}`}
              style={{ '--tone': revealed ? FINDING_TONE[status] : 'var(--faint)' } as CSSProperties}
              onMouseEnter={() => onHover(locus.part)}
              onMouseLeave={() => onHover(active?.part ?? null)}
              onFocus={() => onHover(locus.part)}
              onClick={() => onSelect(isActive ? null : locus.code)}
            >
              <code className="terminal-code">{locus.code}</code>
              <span className="terminal-name">{locus.name}</span>
              <span className="terminal-count">{revealed ? findingsFor(locus.code, ancestor).length : '—'}</span>
              <span className="terminal-status">{revealed ? <FindingBadge status={status} /> : <span className="muted">NOT SCANNED</span>}</span>
            </button>
          )
        })}
      </div>
      {active && (
        <article className="terminal-detail" aria-live="polite" style={{ '--tone': FINDING_TONE[locusStatus(active.code, ancestor)] } as CSSProperties}>
          <header>
            <code>{active.code}</code>
            <h3>{active.name}</h3>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => onSelect(null)}>
              Close
            </button>
          </header>
          <dl>
            <div>
              <dt>Why this matters</dt>
              <dd>{active.why}</dd>
            </div>
            <div>
              <dt>Current architecture</dt>
              <dd>{active.current}</dd>
            </div>
            <div>
              <dt>Quantum consideration</dt>
              <dd>{active.consideration}</dd>
            </div>
            <div>
              <dt>Supported migration</dt>
              <dd>{active.migration}</dd>
            </div>
            <div>
              <dt>Compatibility impact</dt>
              <dd>{active.impact}</dd>
            </div>
          </dl>
          <p className="mono-label">Source</p>
          <SourceList ids={active.sources} compact />
        </article>
      )}
    </div>
  )
}
