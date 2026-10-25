import { ArrowUpRight, OctagonAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { explorerTx } from '../config'
import { type Answer, FAILURES, type FlowError } from '../lib/failures'

const TONE: Record<Answer, string> = { NO: 'is-ok', YES: 'is-bad', 'NETWORK FEE ONLY': 'is-warn', 'CHECK EXPLORER': 'is-warn' }

/** Every failure answers: what happened, did funds move, did QFORK burn, is retry safe, what next. */
export default function FailurePanel({ error, actions }: { error: FlowError; actions?: ReactNode }) {
  const failure = FAILURES[error.code]
  return (
    <section className="failure" role="alert" aria-labelledby={`failure-${error.code}`}>
      <header>
        <OctagonAlert size={18} strokeWidth={1.8} aria-hidden="true" />
        <h3 id={`failure-${error.code}`}>{failure.title}</h3>
      </header>
      <p className="failure-what">{error.detail ?? failure.happened}</p>
      <dl className="failure-grid">
        <div>
          <dt>Funds moved</dt>
          <dd className={TONE[failure.fundsMoved]}>{failure.fundsMoved}</dd>
        </div>
        <div>
          <dt>QFORK burned</dt>
          <dd className={TONE[failure.qforkBurned]}>{failure.qforkBurned}</dd>
        </div>
        <div>
          <dt>Safe to retry</dt>
          <dd className={failure.retrySafe === 'YES' ? 'is-ok' : 'is-warn'}>{failure.retrySafe}</dd>
        </div>
      </dl>
      <p className="failure-next">
        <b>Next:</b> {failure.next}
      </p>
      {error.extra.logs && error.extra.logs.length > 0 && (
        <pre className="failure-logs" aria-label="Dry-run log">
          {error.extra.logs.join('\n')}
        </pre>
      )}
      <div className="failure-foot">
        {error.extra.signature && (
          <a className="btn btn-quiet btn-sm" href={explorerTx(error.extra.signature)} target="_blank" rel="noreferrer noopener">
            View transaction <ArrowUpRight size={13} strokeWidth={1.8} />
          </a>
        )}
        {error.extra.correlationId && <code className="muted">ref {error.extra.correlationId}</code>}
        {actions}
      </div>
    </section>
  )
}
