import type { ReactNode } from 'react'
import { explorerAddress } from '../../config'
import type { Descendant } from '../../lab/registry'
import { networkHref } from '../../lib/networkUi'
import { formatBaseUnits } from '../../protocol/pricing'
import { pumpTradingLink } from '../../protocol/pumpfun'
import { Link } from '../../router'

function Section({ code, title, wide = false, children }: { code: string; title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`report-section ${wide ? 'is-wide' : ''}`} aria-labelledby={`r-${code}`}>
      <header>
        <code>{code}</code>
        <h2 id={`r-${code}`}>{title}</h2>
      </header>
      {children}
    </section>
  )
}

/** A registered descendant's tokens, read-only. Launching happens in the console. */
export default function PublicNetwork({ item, start }: { item: Descendant; start: number }) {
  if (item.origin !== 'registered') return null
  const code = String(start).padStart(2, '0')
  return (
    <Section code={code} title="Tokens" wide>
      {item.tokens.length ? (
        <ul className="kid-list">
          {item.tokens.map((token) => (
            <li key={token.mint}>
              <span>
                <b>${token.symbol}</b> {token.name} · {formatBaseUnits(token.supplyRaw, token.decimals)} supply
              </span>
              <small className="muted">
                {token.kind === 'pumpfun' ? 'PUMP.FUN · MAINNET' : token.kind === 'clanker' ? `CLANKER · ${token.cluster.toUpperCase()}` : `SPL · ${token.cluster.toUpperCase()}`} ·{' '}
                <a href={explorerAddress(token.mint, token.cluster)} target="_blank" rel="noreferrer">
                  mint
                </a>
                {token.kind === 'pumpfun' && (
                  <>
                    {' · '}
                    <a href={pumpTradingLink(token.mint)} target="_blank" rel="noreferrer">
                      trade
                    </a>
                  </>
                )}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No tokens launched yet.</p>
      )}
      <p className="muted">
        Every token here was read from the chain by the server. <Link to={networkHref(item.id)}>Open the descendant console →</Link>
      </p>
    </Section>
  )
}
