import { ArrowRight, ScanLine } from 'lucide-react'
import { type CSSProperties, useMemo, useState } from 'react'
import ExposureMap from '../components/ExposureMap'
import GenomeTerminal from '../components/GenomeTerminal'
import SourceList from '../components/SourceList'
import { FindingBadge } from '../components/Status'
import { FINDING_TONE } from '../lib/tones'
import { SpecimenViewport } from '../components/Viewports'
import { CLIENT_CONFIG } from '../config'
import type { OrganPart } from '../lab/morphology'
import { useScan } from '../lab/useScan'
import { usePageMeta } from '../lib/meta'
import { ANCESTOR_NAME, type AncestorId, ANCESTORS, type CategoryCode, DEFAULT_ANCESTOR, exposureCounts, FINDING_STATUSES, type FindingStatus, isAncestorId, MODELS } from '../protocol/ancestors'
import { ancestorGenome } from '../protocol/descendant'
import { navigate, useLocation } from '../navigation'
import { Link } from '../router'

export function FindingsTable({ filter, ancestor = DEFAULT_ANCESTOR }: { filter: FindingStatus | 'ALL'; ancestor?: AncestorId }) {
  const { findings, loci } = MODELS[ancestor]
  const rows = filter === 'ALL' ? findings : findings.filter((finding) => finding.status === filter)
  return (
    <div className="findings" role="table" aria-label="Exposure findings">
      {rows.map((finding) => (
        <article key={finding.id} className="finding" role="row" style={{ '--tone': FINDING_TONE[finding.status] } as CSSProperties}>
          <header>
            <code>{finding.id}</code>
            <span className="finding-cat">{loci.find((locus) => locus.code === finding.category)?.name}</span>
            <FindingBadge status={finding.status} />
          </header>
          <h3>{finding.primitive}</h3>
          <dl>
            <div>
              <dt>Implementation</dt>
              <dd>{finding.implementation}</dd>
            </div>
            <div>
              <dt>Quantum relevance</dt>
              <dd>{finding.relevance}</dd>
            </div>
            <div>
              <dt>Migration status</dt>
              <dd>{finding.migrationStatus}</dd>
            </div>
            <div>
              <dt>Alternative</dt>
              <dd>{finding.alternative}</dd>
            </div>
            <div>
              <dt>Compatibility</dt>
              <dd>{finding.compatibility}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{finding.confidence}</dd>
            </div>
          </dl>
          <SourceList ids={finding.sources} compact />
        </article>
      ))}
    </div>
  )
}

export default function Scanner() {
  usePageMeta({ title: 'Scanner', description: 'Quantum exposure maps of Base’s and Solana’s cryptographic dependencies, with sources for every finding.', path: '/scanner' })
  const { query } = useLocation()
  const requested = query.get('ancestor')
  const ancestor: AncestorId = isAncestorId(requested) ? requested : DEFAULT_ANCESTOR
  const { model, loci, findings } = MODELS[ancestor]
  const { run, reset, state, revealed, fx } = useScan(false, ancestor)
  const [part, setPart] = useState<OrganPart | null>(null)
  const [locus, setLocus] = useState<CategoryCode | null>(null)
  const [filter, setFilter] = useState<FindingStatus | 'ALL'>('ALL')
  const counts = useMemo(() => exposureCounts(findings), [findings])
  const name = ANCESTOR_NAME[ancestor]
  const genome = useMemo(() => ancestorGenome(ancestor), [ancestor])

  const pick = (next: AncestorId) => {
    if (next === ancestor) return
    setLocus(null)
    setPart(null)
    reset()
    navigate(next === DEFAULT_ANCESTOR ? '/scanner' : `/scanner?ancestor=${next}`, { replace: true, keepScroll: true })
  }
  const done = state === 'done'

  if (!CLIENT_CONFIG.flags.scanner) {
    return (
      <div className="page-head">
        <p className="eyebrow">Scanner</p>
        <h1>Scanner offline.</h1>
        <p className="section-lede">The scanner is switched off in this deployment (ENABLE_SCANNER=false).</p>
      </div>
    )
  }

  return (
    <div className="scanner-page">
      <header className="page-head">
        <p className="eyebrow">Scanner · {name} · {model.kind} · v{model.version}</p>
        <h1>Quantum exposure map.</h1>
        <p className="section-lede">{model.disclaimer}</p>
        <div className="ancestor-pick" role="radiogroup" aria-label="Ancestor">
          {ANCESTORS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={item.id === ancestor}
              disabled={!isAncestorId(item.id)}
              className={`chip ${item.id === ancestor ? 'is-active' : ''}`}
              onClick={() => isAncestorId(item.id) && pick(item.id)}
            >
              {item.name}
              {item.status !== 'AVAILABLE' && <small> · NOT YET SEQUENCED</small>}
            </button>
          ))}
        </div>
      </header>

      <section className="scanner" aria-label="Scanner">
        <div className={`scanner-stage panel is-${state}`}>
          <SpecimenViewport genome={genome} highlight={part} fx={fx} className="scanner-viewport" label={`${ancestor === 'base' ? 'Base' : 'Solana'} organism under the scanner`} />
          <div className="scanner-hud" aria-hidden="true">
            <span>{name} · ANCESTOR // GEN-0</span>
            <span>{state === 'scanning' ? `SCANNING · LOCUS ${revealed}/${loci.length}` : done ? 'SCAN COMPLETE' : 'READY'}</span>
          </div>
          <div className="scanner-actions">
            <button type="button" className="btn btn-primary" onClick={run} disabled={state === 'scanning'}>
              <ScanLine size={15} strokeWidth={1.8} /> {done ? 'Scan again' : state === 'scanning' ? 'Scanning' : 'Run quantum scan'}
            </button>
          </div>
        </div>
        <div className="scanner-side">
          <dl className="scan-tally" aria-live="polite">
            {(['EXPOSED', 'EXTERNAL DEPENDENCY', 'MIGRATION AVAILABLE', 'EXPERIMENTAL', 'REVIEWED', 'UNKNOWN'] as FindingStatus[]).map((status) => (
              <div key={status} style={{ '--tone': FINDING_TONE[status] } as CSSProperties}>
                <dt>{status}</dt>
                <dd>{done ? counts[status] : '—'}</dd>
              </div>
            ))}
          </dl>
          <ExposureMap findings={findings} loci={loci} revealed={revealed} onPick={(code) => setLocus(code)} />
        </div>
      </section>

      <section className="section" aria-labelledby="loci-title">
        <header className="section-head">
          <p className="eyebrow">Genome loci</p>
          <h2 id="loci-title">Where the exposure lives.</h2>
        </header>
        <GenomeTerminal ancestor={ancestor} selected={locus} onSelect={setLocus} onHover={setPart} revealed={done} />
      </section>

      <section className="section" aria-labelledby="findings-title">
        <header className="section-head section-head-row">
          <div>
            <p className="eyebrow">Findings · {findings.length}</p>
            <h2 id="findings-title">Every dependency, sourced.</h2>
          </div>
          <div className="chips" role="group" aria-label="Filter by status">
            {(['ALL', ...FINDING_STATUSES.map((item) => item.status)] as (FindingStatus | 'ALL')[]).map((status) => (
              <button key={status} type="button" className={`chip ${filter === status ? 'is-active' : ''}`} aria-pressed={filter === status} onClick={() => setFilter(status)}>
                {status}
              </button>
            ))}
          </div>
        </header>
        <dl className="status-key">
          {FINDING_STATUSES.map((item) => (
            <div key={item.status}>
              <dt>
                <FindingBadge status={item.status} />
              </dt>
              <dd>{item.meaning}</dd>
            </div>
          ))}
        </dl>
        <FindingsTable filter={filter} ancestor={ancestor} />
      </section>

      <section className="section cta-band panel">
        <div>
          <p className="eyebrow">Next</p>
          <h2>Design a supported migration.</h2>
          <p className="section-lede">Pick a profile, review the diff against {ancestor === 'base' ? 'Base' : 'Solana'}, and see exactly which exposure remains.</p>
        </div>
        <Link to="/lab" className="btn btn-primary btn-lg">
          Open the lab <ArrowRight size={16} strokeWidth={1.8} />
        </Link>
      </section>
    </div>
  )
}
