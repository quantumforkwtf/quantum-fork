import type { ReactNode } from 'react'
import { explorerAddress, explorerTx } from '../../config'
import { timestamp, type ConsoleView } from '../../lib/networkUi'
import { Link } from '../../router'

export function ConsoleSection({ code, title, aside, children, className = '', id }: { code: string; title: string; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`nc-section ${className}`} aria-labelledby={`nc-${code}`} id={id}>
      <header>
        <code>{code}</code>
        <h2 id={`nc-${code}`}>{title}</h2>
        {aside && <div className="nc-section-aside">{aside}</div>}
      </header>
      {children}
    </section>
  )
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="nc-empty">
      <p className="mono-label">{title}</p>
      <p>{children}</p>
      {action}
    </div>
  )
}

interface Record {
  key: string
  at: string | null
  type: string
  title: ReactNode
  proof: ReactNode
}

/** The descendant's history, from server records and chain transactions only. */
export function RecordFeed({ view, limit }: { view: ConsoleView; limit?: number }) {
  const receipt = view.descendant.receipt
  const records: Record[] = []
  if (receipt)
    records.push({
      key: 'burn',
      at: receipt.timestamp,
      type: 'BURN',
      title: `${receipt.amount.toLocaleString('en-US')} ${view.cluster === 'mainnet-beta' ? 'QFORK' : 'test QFORK'} burned`,
      proof: (
        <a href={explorerTx(receipt.signature, view.cluster)} target="_blank" rel="noreferrer">
          transaction
        </a>
      ),
    })
  if (view.registeredAt) records.push({ key: 'registered', at: view.registeredAt, type: 'REGISTERED', title: `${view.code} registered`, proof: <Link to={`/burn/${receipt?.signature ?? ''}`}>receipt</Link> })
  for (const token of view.tokens)
    records.push({
      key: token.mint,
      at: token.createdAt,
      type: token.kind === 'pumpfun' ? 'PUMP.FUN' : token.kind === 'clanker' ? 'CLANKER' : 'SPL TOKEN',
      title: `$${token.symbol} · ${token.name}`,
      proof: (
        <a href={explorerAddress(token.mint, token.cluster)} target="_blank" rel="noreferrer">
          mint
        </a>
      ),
    })
  for (const fork of view.forks) records.push({ key: fork.id, at: fork.createdAt, type: 'FORK', title: `${fork.code} forked from ${view.code}`, proof: <Link to={`/species/${fork.id}`}>page</Link> })
  records.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  const shown = limit ? records.slice(0, limit) : records
  if (!shown.length) return <p className="muted">No records yet.</p>
  return (
    <ol className="nc-feed">
      {shown.map((record) => (
        <li key={record.key} className="is-verified">
          <time>{timestamp(record.at).slice(0, 19)}</time>
          <span className="nc-feed-type">{record.type}</span>
          <span className="nc-feed-title">
            <b>{record.title}</b>
          </span>
          <span className="nc-feed-status">{record.proof}</span>
        </li>
      ))}
    </ol>
  )
}
