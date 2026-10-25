import { ArrowRight } from 'lucide-react'
import { ConsoleSection, EmptyState } from '../../components/network/Parts'
import { explorerAddress } from '../../config'
import { type TabProps, timestamp } from '../../lib/networkUi'
import { shortAddress } from '../../protocol/address'
import { formatBaseUnits } from '../../protocol/pricing'
import { clankerLink } from '../../protocol/clanker'
import { pumpTradingLink } from '../../protocol/pumpfun'

export function Tokens({ view, launch }: TabProps) {
  return (
    <>
      <header className="nc-tab-head">
        <div>
          <h2>Tokens</h2>
          <p className="section-lede">Real {view.chain === 'base' ? 'Base' : 'Solana'} tokens launched for {view.code}. Each one is recorded only after the server reads its creation transaction and mint from the chain.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={launch} disabled={!view.owned}>
          Launch a token <ArrowRight size={15} strokeWidth={1.8} />
        </button>
      </header>

      {!view.tokens.length ? (
        <EmptyState
          title="No tokens yet"
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={launch} disabled={!view.owned}>
              Launch a token <ArrowRight size={13} strokeWidth={1.8} />
            </button>
          }
        >
          {view.owned ? (view.chain === 'base' ? `Launch a Clanker token on ${view.network === 'base' ? 'Base' : 'Base Sepolia'}.` : `Choose an SPL token on ${view.cluster}, or a Pump.fun token on mainnet.`) : `Only the wallet that burned for ${view.code} can launch its tokens.`}
        </EmptyState>
      ) : (
        <ConsoleSection code="01" title="Launched" className="is-wide">
          <div className="nc-table" role="table" aria-label="Tokens">
            <div className="nc-row nc-row-head nc-tokens" role="row">
              {['Token', 'Type', 'Network', 'Supply', 'Supply locked', 'Mint', 'Created'].map((label) => (
                <span key={label} role="columnheader">
                  {label}
                </span>
              ))}
            </div>
            {view.tokens.map((token) => (
              <div key={token.mint} className="nc-row nc-tokens" role="row">
                <span role="cell">
                  <b>${token.symbol}</b> {token.name}
                </span>
                <span role="cell">{token.kind === 'pumpfun' ? 'Pump.fun' : token.kind === 'clanker' ? 'Clanker' : 'SPL'}</span>
                <span role="cell">{token.cluster === 'mainnet-beta' ? 'Mainnet' : token.cluster === 'base' ? 'Base' : token.cluster === 'base-sepolia' ? 'Base Sepolia' : token.cluster}</span>
                <span role="cell">{formatBaseUnits(token.supplyRaw, token.decimals)}</span>
                <span role="cell" className="nc-status">
                  {token.kind === 'pumpfun' ? 'BY CURVE' : token.mintAuthority ? 'NO' : 'YES'}
                </span>
                <span role="cell">
                  <a href={explorerAddress(token.mint, token.cluster)} target="_blank" rel="noreferrer">
                    <code>{shortAddress(token.mint, 6, 6)}</code>
                  </a>
                  {token.kind === 'pumpfun' && (
                    <>
                      {' · '}
                      <a href={pumpTradingLink(token.mint)} target="_blank" rel="noreferrer">
                        pump.fun
                      </a>
                    </>
                  )}
                  {token.kind === 'clanker' && clankerLink(token.mint, token.cluster) && (
                    <>
                      {' · '}
                      <a href={clankerLink(token.mint, token.cluster)!} target="_blank" rel="noreferrer">
                        clanker
                      </a>
                    </>
                  )}
                </span>
                <span role="cell" className="muted">
                  {timestamp(token.createdAt).slice(0, 16)}
                </span>
              </div>
            ))}
          </div>
          <p className="nc-fineprint">Supply is read from the mint account. “Supply locked” means the mint authority was revoked, so nobody can mint more.</p>
        </ConsoleSection>
      )}
    </>
  )
}
