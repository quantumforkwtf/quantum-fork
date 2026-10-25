import type { CSSProperties } from 'react'
import { type CategoryCode, type ExposureFinding, FINDING_STATUSES, type FindingStatus, type GenomeLocus, LOCI } from '../protocol/ancestors'
import { FINDING_TONE } from '../lib/tones'

/**
 * Category × status grid. Counts findings; deliberately shows no score or
 * percentage, because the categories are not comparable quantities.
 */
export default function ExposureMap({ findings, loci = LOCI, revealed, onPick }: { findings: ExposureFinding[]; loci?: GenomeLocus[]; revealed: number; onPick?: (code: CategoryCode) => void }) {
  const statuses = FINDING_STATUSES.map((item) => item.status).filter((status) => status !== 'NOT APPLICABLE')
  return (
    <figure className="exposure-map">
      <figcaption className="mono-label">Quantum exposure map · {findings.length} findings</figcaption>
      <div className="xmap" style={{ '--cols': statuses.length } as CSSProperties} role="table" aria-label="Findings by category and status">
        <div className="xmap-row xmap-head" role="row">
          <span role="columnheader">LOCUS</span>
          {statuses.map((status) => (
            <span key={status} role="columnheader" style={{ '--tone': FINDING_TONE[status] } as CSSProperties}>
              {status}
            </span>
          ))}
        </div>
        {loci.map((locus, row) => (
          <div key={locus.code} className="xmap-row" role="row">
            <button type="button" role="rowheader" className="xmap-locus" onClick={() => onPick?.(locus.code)} disabled={!onPick}>
              <code>{locus.code}</code>
            </button>
            {statuses.map((status: FindingStatus) => {
              const count = findings.filter((finding) => finding.category === locus.code && finding.status === status).length
              const shown = row < revealed
              return (
                <span key={status} role="cell" className={`xmap-cell ${shown && count ? 'is-hit' : ''}`} style={{ '--tone': FINDING_TONE[status] } as CSSProperties}>
                  {shown && count ? count : ''}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </figure>
  )
}
