import { ArrowRight } from 'lucide-react'
import type { CSSProperties } from 'react'
import { NetworkOrganism } from '../../components/network/NetworkOrganism'
import { ConsoleSection, RecordFeed } from '../../components/network/Parts'
import { formatNumber } from '../../lib/hooks'
import { networkHref, type TabProps, timestamp } from '../../lib/networkUi'
import { remainingExposure } from '../../protocol/descendant'
import { PROFILE_BY_ID, strainLabel } from '../../protocol/profiles'
import { Link } from '../../router'

const TONE = { done: 'var(--green)', todo: 'var(--yellow)', missing: 'var(--muted)' } as const

export function Overview({ view, launch }: TabProps) {
  const { config, descendant } = view
  const profile = PROFILE_BY_ID[config.profile]
  const receipt = descendant.receipt
  const remaining = remainingExposure(config)

  const exists: { label: string; state: string; tone: keyof typeof TONE; href?: string }[] = [
    { label: 'Registered design', state: 'DONE', tone: 'done', href: `/species/${view.id}` },
    { label: 'Burn receipt', state: receipt ? 'VERIFIED' : 'MISSING', tone: receipt ? 'done' : 'missing', href: receipt ? `/burn/${receipt.signature}` : undefined },
    { label: 'Token', state: view.tokens.length ? `${view.tokens.length} LIVE` : 'NOT YET', tone: view.tokens.length ? 'done' : 'todo', href: networkHref(view.id, 'tokens') },
    { label: 'Developer kit', state: 'READY', tone: 'done', href: networkHref(view.id, 'developers') },
    { label: 'Running chain (validators, RPC, explorer)', state: 'NOT BUILT', tone: 'missing' },
  ]

  return (
    <>
      <div className="nc-overview">
        <NetworkOrganism view={view} />
        <aside className="nc-overview-side">
          <p className="nc-alive">
            <i aria-hidden="true" /> Registered
          </p>
          <dl className="report">
            <div>
              <dt>Identity</dt>
              <dd>
                {view.code} · <code>{config.network.networkId}</code>
              </dd>
            </div>
            <div>
              <dt>Ancestor</dt>
              <dd>
                {config.ancestor === 'base' ? 'Base' : 'Solana'}
                {descendant.parentId && descendant.parentId !== config.ancestor ? ` · parent ${descendant.parentId}` : ''}
              </dd>
            </div>
            <div>
              <dt>Generation</dt>
              <dd>GEN-{descendant.generation}</dd>
            </div>
            <div>
              <dt>PQ profile</dt>
              <dd>{strainLabel(profile)}</dd>
            </div>
            <div>
              <dt>QFORK burned</dt>
              <dd>{receipt ? `${formatNumber(receipt.amount)} ${view.network === 'mainnet-beta' || view.network === 'base' ? 'QFORK' : 'test QFORK'} · verified on ${view.network}` : '—'}</dd>
            </div>
            <div>
              <dt>Registered</dt>
              <dd>{timestamp(view.registeredAt)}</dd>
            </div>
            <div>
              <dt>Descendants</dt>
              <dd>{view.forks.length}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <div className="nc-grid">
        <ConsoleSection code="01" title="Next step" className="is-wide">
          {view.tokens.length === 0 ? (
            <div className="nc-next">
              <div>
                <p className="mono-label">Next</p>
                <h3>Launch its token.</h3>
                <p className="muted">
                  {view.chain === 'base' ? 'A Clanker token on Base.' : `An SPL token on Solana ${view.cluster}, or a Pump.fun token on mainnet.`} Created from your wallet; recorded here once the server reads it from the chain.
                </p>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={launch} disabled={!view.owned}>
                Launch a token <ArrowRight size={13} strokeWidth={1.8} />
              </button>
            </div>
          ) : (
            <div className="nc-next">
              <div>
                <p className="mono-label">Next</p>
                <h3>Hand it to developers, or fork it.</h3>
                <p className="muted">The developer kit points at the real cluster and the real mints. A fork starts a new descendant from this one’s genome.</p>
              </div>
              <div className="nc-inline-actions">
                <Link to={networkHref(view.id, 'developers')} className="btn btn-secondary btn-sm">
                  Developer kit
                </Link>
                <Link to={`/lab?parent=${view.id}`} className="btn btn-quiet btn-sm">
                  Fork it
                </Link>
              </div>
            </div>
          )}
          {!view.owned && <p className="nc-fineprint">Launching tokens needs the wallet that burned for {view.code}.</p>}
        </ConsoleSection>

        <ConsoleSection code="02" title="What exists">
          <ul className="nc-ready">
            {exists.map((item) => (
              <li key={item.label} style={{ '--tone': TONE[item.tone] } as CSSProperties}>
                <i aria-hidden="true" />
                <span>{item.href ? <Link to={item.href}>{item.label}</Link> : item.label}</span>
                <b>{item.state}</b>
              </li>
            ))}
          </ul>
          <p className="nc-fineprint">No chain runs a descendant yet. Its burn and its tokens are real {view.chain === 'base' ? 'Base' : 'Solana'} transactions.</p>
        </ConsoleSection>

        <ConsoleSection code="03" title="Cryptography">
          <dl className="report">
            <div>
              <dt>Genome</dt>
              <dd>
                {config.modules.length} post-quantum module{config.modules.length === 1 ? '' : 's'} · {remaining.length} classical loc{remaining.length === 1 ? 'us' : 'i'} remaining · <Link to={networkHref(view.id, 'cryptography')}>details</Link>
              </dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>
                {view.chain === 'base' ? 'Base tokens are held by secp256k1 (ECDSA) accounts like every Base asset.' : 'Solana tokens sign with Ed25519 like every Solana asset.'} The genome describes the descendant, not the tokens.
              </dd>
            </div>
          </dl>
        </ConsoleSection>

        <ConsoleSection code="04" title="Records" className="is-wide">
          <RecordFeed view={view} limit={12} />
          <p className="nc-fineprint">Every line links to its proof: a transaction, a mint, a receipt or a page.</p>
        </ConsoleSection>
      </div>
    </>
  )
}
