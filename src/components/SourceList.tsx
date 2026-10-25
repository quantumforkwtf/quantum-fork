import { ArrowUpRight } from 'lucide-react'
import { type SourceId, sourcesFor } from '../protocol/sources'

export default function SourceList({ ids, compact = false }: { ids: readonly SourceId[]; compact?: boolean }) {
  const sources = sourcesFor(ids)
  if (!sources.length) return null
  return (
    <ol className={`sources ${compact ? 'is-compact' : ''}`}>
      {sources.map((source) => (
        <li key={source.id}>
          <a href={source.url} target="_blank" rel="noreferrer noopener">
            <span className="source-kind">{source.kind}</span>
            <span className="source-title">{source.title}</span>
            <span className="source-pub">
              {source.publisher}
              <ArrowUpRight size={12} strokeWidth={1.8} aria-hidden="true" />
            </span>
          </a>
          {!compact && source.note && <p className="source-note">{source.note}</p>}
        </li>
      ))}
    </ol>
  )
}
