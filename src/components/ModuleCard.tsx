import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'
import { MODULE_BY_ID, type PqModule } from '../protocol/modules'
import { formatNumber } from '../lib/hooks'
import { ModuleBadge } from './Status'
import SourceList from './SourceList'

interface ModuleCardProps {
  module: PqModule
  selected?: boolean
  locked?: boolean
  onToggle?: () => void
  expanded?: boolean
}

export default function ModuleCard({ module, selected = false, locked = false, onToggle, expanded = false }: ModuleCardProps) {
  const body = (
    <>
      <header className="pq-head">
        <code>{module.code}</code>
        <ModuleBadge status={module.status} />
      </header>
      <h3>{module.name}</h3>
      <p className="pq-summary">{module.summary}</p>
      <dl className="pq-specs">
        <div>
          <dt>Primitive</dt>
          <dd>{module.primitive}</dd>
        </div>
        <div>
          <dt>Standard</dt>
          <dd>{module.standard}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{module.sizeImpact ?? '—'}</dd>
        </div>
        <div>
          <dt>Complexity</dt>
          <dd>{module.complexity}</dd>
        </div>
        {expanded && (
          <>
            <div>
              <dt>Compatibility</dt>
              <dd>{module.compatibility}</dd>
            </div>
            <div>
              <dt>Performance</dt>
              <dd>{module.performance}</dd>
            </div>
            <div>
              <dt>Implementation</dt>
              <dd>{module.implementation}</dd>
            </div>
            <div>
              <dt>Requires</dt>
              <dd>{module.dependencies.length ? module.dependencies.map((id) => MODULE_BY_ID[id].code).join(' · ') : 'None'}</dd>
            </div>
          </>
        )}
      </dl>
      {module.warning && <p className="pq-warn">{module.warning}</p>}
      <footer className="pq-foot">
        <span className="pq-burn">
          {formatNumber(module.burn)} <small>QFORK</small>
        </span>
      </footer>
      {expanded && module.repositories.length + module.documentation.length > 0 && <SourceList ids={[...module.documentation, ...module.repositories]} compact />}
    </>
  )

  if (!onToggle) {
    return (
      <article className="pq-card" style={{ '--tone': module.color } as CSSProperties}>
        {body}
      </article>
    )
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-disabled={locked}
      className={`pq-card is-selectable ${selected ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}`}
      style={{ '--tone': module.color } as CSSProperties}
      onClick={() => !locked && onToggle()}
      title={locked ? 'Required by another selected module' : undefined}
    >
      <span className="pq-check" aria-hidden="true">
        {selected && <Check size={13} strokeWidth={2.4} />}
      </span>
      {body}
    </button>
  )
}
