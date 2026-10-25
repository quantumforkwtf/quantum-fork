import { ArrowRight, Check, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CLIENT_CONFIG, explorerAddress, explorerTx, useServerStatus } from '../../config'
import { addToken } from '../../lab/registry'
import { type ClankerReview, pendingClanker, prepareClankerLaunch, sendClankerLaunch, verifyClankerLaunch } from '../../lib/evm/launch'
import { useEvmWallet } from '../../lib/evm/wallet'
import { FlowError } from '../../lib/failures'
import type { ConsoleView } from '../../lib/networkUi'
import { type PumpReview, preparePumpLaunch, prepareSplLaunch, sendPumpLaunch, sendSplLaunch, type SplReview, verifyLaunch } from '../../lib/solana/launch'
import { refreshBalances, useWallet } from '../../lib/solana/wallet'
import { shortAddress } from '../../protocol/address'
import { CLANKER_FACTORY, clankerLink } from '../../protocol/clanker'
import { pumpTradingLink } from '../../protocol/pumpfun'
import { clankerSpecSchema, PUMP_COST_HINT_SOL, pumpSpecSchema, SPL_COST_HINT_SOL, splSpecSchema, type TokenKind, type TokenRecord } from '../../protocol/tokens'
import FailurePanel from '../FailurePanel'

type Stage = 'kind' | 'configure' | 'review' | 'launch'
const STAGES: Stage[] = ['kind', 'configure', 'review', 'launch']
const STAGE_LABEL: Record<Stage, string> = { kind: 'Choose', configure: 'Configure', review: 'Review', launch: 'Launch' }

const sol = (lamports: bigint) => `${(Number(lamports) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 6 })} SOL`
const eth = (wei: bigint) => `${(Number(wei) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 8 })} ETH`
const clusterLabel = (cluster: string) => (cluster === 'mainnet-beta' ? 'Solana mainnet' : cluster === 'base' ? 'Base' : cluster === 'base-sepolia' ? 'Base Sepolia' : `Solana ${cluster}`)

export function LaunchToken({ view, onClose }: { view: ConsoleView; onClose: () => void }) {
  const status = useServerStatus()
  const wallet = useWallet()
  const evm = useEvmWallet()
  const onBase = view.chain === 'base'
  const panel = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Stage>('kind')
  const [kind, setKind] = useState<TokenKind>(onBase ? 'clanker' : 'spl')
  const [name, setName] = useState(`${view.config.network.name}`.slice(0, 32))
  const [symbol, setSymbol] = useState(view.config.network.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))
  const [description, setDescription] = useState('')
  const [supply, setSupply] = useState('1000000000')
  const [decimals, setDecimals] = useState(6)
  const [fixedSupply, setFixedSupply] = useState(true)
  const [devBuy, setDevBuy] = useState('0')
  const [understood, setUnderstood] = useState(false)
  const [issues, setIssues] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<FlowError | null>(null)
  const [review, setReview] = useState<SplReview | PumpReview | ClankerReview | null>(null)
  const [signature, setSignature] = useState<string | null>(null)
  const [token, setToken] = useState<TokenRecord | null>(null)

  const pumpEnabled = status.state === 'ok' && status.status.flags.pumpfunLaunch
  const base = status.state === 'ok' ? status.status.base : undefined
  const clankerEnabled = Boolean(base?.clankerLaunch)
  const cluster = CLIENT_CONFIG.network

  useEffect(() => {
    if (!onBase) return
    const pending = pendingClanker(view.id)
    if (!pending) return
    const controller = new AbortController()
    setStage('launch')
    setSignature(pending.hash)
    setBusy('Resuming: waiting for Base to finalize the launch transaction…')
    verifyClankerLaunch(view.id, pending.launchId, pending.hash, controller.signal)
      .then((verified) => {
        addToken(verified)
        setToken(verified)
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof FlowError ? caught : new FlowError('TOKEN_NOT_RECORDED', undefined, { signature: pending.hash }))
      })
      .finally(() => !controller.signal.aborted && setBusy(null))
    return () => controller.abort()
  }, [onBase, view.id])

  useEffect(() => {
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && (!busy || Boolean(signature && onBase)) && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onBase, onClose, signature])

  const owner = onBase ? evm.address : wallet.address

  const toReview = async () => {
    setIssues([])
    setError(null)
    if (!owner) return setError(new FlowError('WALLET_NOT_FOUND', 'Connect the wallet that burned for this descendant.'))
    if (kind === 'clanker') {
      const parsed = clankerSpecSchema.safeParse({ name, symbol, description })
      if (!parsed.success) return setIssues(parsed.error.issues.map((issue) => issue.message))
      if (!base) return setError(new FlowError('API_UNAVAILABLE'))
      setBusy('Building the Clanker transaction and dry-running it…')
      try {
        setReview(await prepareClankerLaunch(view.id, owner as `0x${string}`, parsed.data, base.network, base.chainId))
        setUnderstood(false)
        setStage('review')
      } catch (caught) {
        setError(caught instanceof FlowError ? caught : new FlowError('API_UNAVAILABLE'))
      } finally {
        setBusy(null)
      }
      return
    }
    const fields = { name, symbol, description }
    const parsed = kind === 'spl' ? splSpecSchema.safeParse({ ...fields, decimals, supply, fixedSupply }) : pumpSpecSchema.safeParse({ ...fields, devBuySol: Number(devBuy) })
    if (!parsed.success) return setIssues(parsed.error.issues.map((issue) => issue.message))
    setBusy(kind === 'spl' ? 'Building and dry-running the transaction…' : 'Asking PumpPortal for the create transaction…')
    try {
      const next = kind === 'spl' ? await prepareSplLaunch(view.id, owner, splSpecSchema.parse(parsed.data)) : await preparePumpLaunch(view.id, owner, pumpSpecSchema.parse(parsed.data))
      setReview(next)
      setUnderstood(false)
      setStage('review')
    } catch (caught) {
      setError(caught instanceof FlowError ? caught : new FlowError('API_UNAVAILABLE'))
    } finally {
      setBusy(null)
    }
  }

  const launch = async () => {
    if (!review || !owner) return
    setError(null)
    setStage('launch')
    setBusy('Approve the transaction in your wallet…')
    let sent: string | null = null
    try {
      let verified: TokenRecord
      if (review.kind === 'clanker') {
        const hash = await sendClankerLaunch(review)
        sent = hash
        setSignature(hash)
        setBusy('Sent. The server records the token once Base finalizes the block, usually 15 to 20 minutes. You can close this and reopen it later.')
        verified = await verifyClankerLaunch(view.id, review.prepared.launchId, hash)
      } else {
        sent = review.kind === 'spl' ? await sendSplLaunch(review, owner) : await sendPumpLaunch(review)
        setSignature(sent)
        setBusy('Sent. Waiting for the server to read it from the chain…')
        verified = await verifyLaunch(review.prepared.mint, sent)
      }
      addToken(verified)
      setToken(verified)
      void refreshBalances()
    } catch (caught) {
      setError(caught instanceof FlowError ? caught : new FlowError('TOKEN_NOT_RECORDED', undefined, sent ? { signature: sent } : {}))
      if (!sent) setReview(null)
    } finally {
      setBusy(null)
    }
  }

  const mintCluster = review?.prepared.cluster ?? (onBase ? (base?.network ?? 'base') : kind === 'pumpfun' ? 'mainnet-beta' : cluster)

  return (
    <div className="overlay build-overlay" role="dialog" aria-modal="true" aria-labelledby="launch-title" onClick={(event) => event.target === event.currentTarget && (!busy || Boolean(signature && onBase)) && onClose()}>
      <div ref={panel} className="build-dialog module-dialog" tabIndex={-1}>
        <header className="build-dialog-head">
          <div>
            <p className="eyebrow">
              {view.code} · Launch a token
            </p>
            <h2 id="launch-title">A real token for {view.config.network.name}.</h2>
            <p className="muted">Created from your wallet, recorded against this descendant after the server reads it from the chain.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" disabled={Boolean(busy) && !(signature && onBase)}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </header>

        <ol className="mf-steps" aria-label="Steps">
          {STAGES.map((item, index) => (
            <li key={item} className={stage === item ? 'is-on' : STAGES.indexOf(stage) > index ? 'is-done' : ''}>
              <code>{String(index + 1).padStart(2, '0')}</code> {STAGE_LABEL[item]}
            </li>
          ))}
        </ol>

        {!view.owned && (
          <p className="callout is-warn">
            {owner ? `The connected wallet (${shortAddress(owner)}) did not burn for ${view.code}.` : 'Connect a wallet.'} Only the wallet that registered this descendant can launch its tokens.
          </p>
        )}

        {stage === 'kind' && (
          <div className="mf-form">
            <div className="mf-options lt-kinds" role="radiogroup" aria-label="Token type">
              {onBase ? (
                <button type="button" role="radio" aria-checked className="mf-option lt-kind is-on" disabled={!clankerEnabled}>
                  <b>Clanker token</b>
                  <span>On {base?.network === 'base-sepolia' ? 'Base Sepolia' : 'Base'}. An ERC-20 with 100,000,000,000 supply, paired with WETH in a Uniswap v4 pool, through the Clanker v4 factory.</span>
                  <small>{clankerEnabled ? (base?.network === 'base' ? 'Real ETH: gas only, no launch fee' : 'Base Sepolia: test ETH, which has no value') : 'Switched off on this server'}</small>
                </button>
              ) : (
                <>
              <button type="button" role="radio" aria-checked={kind === 'spl'} className={`mf-option lt-kind ${kind === 'spl' ? 'is-on' : ''}`} onClick={() => setKind('spl')}>
                <b>SPL token</b>
                <span>On Solana {cluster}. You set the supply and decimals, and can lock the supply forever.</span>
                <small>{cluster === 'mainnet-beta' ? `About ${SPL_COST_HINT_SOL} SOL in rent and fees` : `Devnet: about ${SPL_COST_HINT_SOL} devnet SOL, which has no value`}</small>
              </button>
              <button type="button" role="radio" aria-checked={kind === 'pumpfun'} disabled={!pumpEnabled} className={`mf-option lt-kind ${kind === 'pumpfun' ? 'is-on' : ''}`} onClick={() => setKind('pumpfun')}>
                <b>Pump.fun token</b>
                <span>On Solana mainnet. 1,000,000,000 supply on a bonding curve, tradeable on pump.fun the moment it lands.</span>
                <small>{pumpEnabled ? `Real SOL: about ${PUMP_COST_HINT_SOL} SOL plus any first buy` : 'Switched off on this server'}</small>
              </button>
                </>
              )}
            </div>
            <div className="mf-actions">
              <button type="button" className="btn btn-primary" onClick={() => setStage('configure')} disabled={!view.owned || (kind === 'pumpfun' && !pumpEnabled) || (kind === 'clanker' && !clankerEnabled)}>
                Continue <ArrowRight size={15} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        )}

        {stage === 'configure' && (
          <form
            className="mf-form"
            onSubmit={(event) => {
              event.preventDefault()
              void toReview()
            }}
          >
            <label className="mf-field" htmlFor="lt-name">
              <span className="mono-label">Name</span>
              <input id="lt-name" className="input" value={name} maxLength={32} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="mf-field" htmlFor="lt-symbol">
              <span className="mono-label">Symbol</span>
              <input id="lt-symbol" className="input" value={symbol} maxLength={10} onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            </label>
            <label className="mf-field" htmlFor="lt-description">
              <span className="mono-label">Description (optional)</span>
              <input id="lt-description" className="input" value={description} maxLength={280} onChange={(event) => setDescription(event.target.value)} />
              <small className="mf-hint">Shown by wallets and explorers. The image is generated from the symbol and this descendant.</small>
            </label>
            {kind === 'clanker' ? (
              <p className="mf-hint">Clanker fixes the supply at 100,000,000,000 with 18 decimals. Nobody can mint more.</p>
            ) : kind === 'spl' ? (
              <>
                <label className="mf-field" htmlFor="lt-supply">
                  <span className="mono-label">Supply (whole tokens)</span>
                  <input id="lt-supply" className="input" inputMode="numeric" value={supply} onChange={(event) => setSupply(event.target.value.replace(/[^0-9]/g, ''))} />
                </label>
                <label className="mf-field" htmlFor="lt-decimals">
                  <span className="mono-label">Decimals</span>
                  <input id="lt-decimals" className="input" type="number" min={0} max={9} value={decimals} onChange={(event) => setDecimals(Math.max(0, Math.min(9, Number(event.target.value) || 0)))} />
                </label>
                <label className="mf-field lt-check">
                  <input type="checkbox" checked={fixedSupply} onChange={(event) => setFixedSupply(event.target.checked)} />
                  <span>Fixed supply: revoke the mint authority in the same transaction, so nobody (you included) can ever mint more.</span>
                </label>
              </>
            ) : (
              <label className="mf-field" htmlFor="lt-buy">
                <span className="mono-label">First buy (SOL, optional)</span>
                <input id="lt-buy" className="input" inputMode="decimal" value={devBuy} onChange={(event) => setDevBuy(event.target.value.replace(/[^0-9.]/g, ''))} />
                <small className="mf-hint">Buys your own token on the curve in the same transaction. 0 creates it without buying.</small>
              </label>
            )}
            {issues.map((issue) => (
              <p key={issue} className="field-error">
                {issue}
              </p>
            ))}
            {error && <FailurePanel error={error} />}
            <div className="mf-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setStage('kind')} disabled={Boolean(busy)}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || !view.owned}>
                {busy ?? 'Review transaction'} {!busy && <ArrowRight size={15} strokeWidth={1.8} />}
              </button>
            </div>
          </form>
        )}

        {stage === 'review' && review?.kind === 'clanker' && (
          <div className="mf-review">
            <div className="mf-review-grid">
              <div>
                <p className="mono-label">Token</p>
                <dl className="report">
                  <div>
                    <dt>Name</dt>
                    <dd>
                      {review.spec.name} · ${review.spec.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd>{review.prepared.cluster === 'base' ? 'Base mainnet · real ETH' : 'Base Sepolia · test ETH, no value'}</dd>
                  </div>
                  <div>
                    <dt>Contract called</dt>
                    <dd>
                      <a href={explorerAddress(CLANKER_FACTORY, review.prepared.cluster)} target="_blank" rel="noreferrer">
                        <code>{CLANKER_FACTORY}</code>
                      </a>{' '}
                      · Clanker v4 deployToken
                    </dd>
                  </div>
                  <div>
                    <dt>Supply</dt>
                    <dd>100,000,000,000 · 18 decimals · fixed by Clanker</dd>
                  </div>
                  <div>
                    <dt>Value sent</dt>
                    <dd>0 ETH</dd>
                  </div>
                  <div>
                    <dt>Gas</dt>
                    <dd>
                      about {eth(review.feeWei)} · wallet holds {eth(review.ethWei)}
                    </dd>
                  </div>
                  <div>
                    <dt>Image</dt>
                    <dd>
                      <a href={review.prepared.image} target="_blank" rel="noreferrer">
                        {review.prepared.image.replace(/^https?:\/\//, '')}
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>
              <div>
                <p className="mono-label">What the transaction does</p>
                <ul className="notes">
                  <li>Creates a new ERC-20 with your wallet as token admin, which can later update its image and description</li>
                  <li>
                    Puts the whole supply in a Uniswap v4 pool paired with {review.prepared.pairedToken.toLowerCase() === '0x4200000000000000000000000000000000000006' ? 'WETH' : <code>{review.prepared.pairedToken}</code>}, with the liquidity locked by Clanker
                  </li>
                  <li>Sends 100% of the creator share of LP fees to {shortAddress(review.prepared.rewardRecipient)}. Clanker keeps its own protocol share</li>
                  <li>Writes a permanent tag naming {view.code} on-chain. It cannot be changed later</li>
                  <li>No first buy. Your wallet pays gas only</li>
                </ul>
                <label className="mf-field lt-check lt-ack">
                  <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
                  <span>
                    {review.prepared.cluster === 'base'
                      ? 'I understand this spends real ETH on Base and creates a public token anyone can trade. It cannot be undone.'
                      : 'I understand this creates a public test token on Base Sepolia. It cannot be undone.'}
                  </span>
                </label>
              </div>
            </div>
            <div className="mf-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setStage('configure')}>
                Back
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void launch()} disabled={!understood}>
                Sign and launch <ArrowRight size={15} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        )}

        {stage === 'review' && review && review.kind !== 'clanker' && (
          <div className="mf-review">
            <div className="mf-review-grid">
              <div>
                <p className="mono-label">Token</p>
                <dl className="report">
                  <div>
                    <dt>Name</dt>
                    <dd>
                      {review.spec.name} · ${review.spec.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Mint address</dt>
                    <dd>
                      <code>{review.prepared.mint}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd>{review.prepared.cluster === 'mainnet-beta' ? 'Solana mainnet · real SOL' : `Solana ${review.prepared.cluster} · test SOL, no value`}</dd>
                  </div>
                  {review.kind === 'spl' ? (
                    <>
                      <div>
                        <dt>Supply</dt>
                        <dd>
                          {BigInt(review.spec.supply).toLocaleString('en-US')} · {review.spec.decimals} decimals · {review.spec.fixedSupply ? 'fixed forever' : 'you keep the mint authority'}
                        </dd>
                      </div>
                      <div>
                        <dt>Cost</dt>
                        <dd>
                          about {sol(review.feeLamports + review.rentLamports)} plus metadata and token-account rent · wallet holds {sol(review.lamports)}
                        </dd>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <dt>Supply</dt>
                        <dd>1,000,000,000 · 6 decimals · fixed by Pump.fun</dd>
                      </div>
                      <div>
                        <dt>First buy</dt>
                        <dd>{review.spec.devBuySol ? `${review.spec.devBuySol} SOL` : 'None'}</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>Metadata</dt>
                    <dd>
                      <a href={review.prepared.uri} target="_blank" rel="noreferrer">
                        {review.prepared.uri.replace(/^https?:\/\//, '')}
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>
              <div>
                <p className="mono-label">What the transaction does</p>
                <ul className="notes">
                  {review.kind === 'spl' ? (
                    review.instructions.map((line) => <li key={line}>{line}</li>)
                  ) : (
                    <>
                      <li>Pump.fun “create”: a new mint, its bonding curve and on-chain metadata, built by PumpPortal</li>
                      <li>A fresh mint key, generated in this browser, co-signs once and is then discarded</li>
                      {review.spec.devBuySol > 0 && <li>Buys {review.spec.devBuySol} SOL of the token for your wallet</li>}
                      <li>Your wallet pays every fee. Pump.fun and PumpPortal fees apply to any buy</li>
                    </>
                  )}
                </ul>
                {review.kind === 'pumpfun' && (
                  <label className="mf-field lt-check lt-ack">
                    <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
                    <span>I understand this spends real SOL on mainnet and creates a public token anyone can trade. It cannot be undone.</span>
                  </label>
                )}
              </div>
            </div>
            <div className="mf-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setStage('configure')}>
                Back
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void launch()} disabled={review.kind === 'pumpfun' && !understood}>
                Sign and launch <ArrowRight size={15} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        )}

        {stage === 'launch' && (
          <div className="mf-deploy" aria-live="polite">
            {busy && <p className="muted">{busy}</p>}
            {signature && (
              <p className="muted">
                Transaction{' '}
                <a href={explorerTx(signature, mintCluster)} target="_blank" rel="noreferrer">
                  {shortAddress(signature, 8, 8)}
                </a>
              </p>
            )}
            {error && (
              <>
                <FailurePanel error={error} />
                <div className="mf-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setError(null)
                      setSignature(null)
                      setStage('configure')
                    }}
                  >
                    Start again
                  </button>
                </div>
              </>
            )}
            {token && (
              <div className="mf-verified">
                <p className="mf-verified-title">
                  <Check size={16} strokeWidth={2} /> ${token.symbol} is live on {clusterLabel(token.cluster)}.
                </p>
                <dl className="report">
                  <div>
                    <dt>{token.kind === 'clanker' ? 'Contract' : 'Mint'}</dt>
                    <dd>
                      <a href={explorerAddress(token.mint, token.cluster)} target="_blank" rel="noreferrer">
                        <code>{token.mint}</code>
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Verified</dt>
                    <dd>{token.kind === 'clanker' ? 'deployToken transaction and TokenCreated event read by the server at a finalized Base block' : 'Creation transaction and mint read from the chain by the server'}</dd>
                  </div>
                </dl>
                <div className="mf-actions is-start">
                  {token.kind === 'pumpfun' && (
                    <a className="btn btn-primary" href={pumpTradingLink(token.mint)} target="_blank" rel="noreferrer">
                      Open on pump.fun →
                    </a>
                  )}
                  {token.kind === 'clanker' && clankerLink(token.mint, token.cluster) && (
                    <a className="btn btn-primary" href={clankerLink(token.mint, token.cluster)!} target="_blank" rel="noreferrer">
                      Open on Clanker →
                    </a>
                  )}
                  <a className="btn btn-secondary" href={explorerAddress(token.mint, token.cluster)} target="_blank" rel="noreferrer">
                    Explorer →
                  </a>
                  <button type="button" className="btn btn-quiet" onClick={onClose}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
