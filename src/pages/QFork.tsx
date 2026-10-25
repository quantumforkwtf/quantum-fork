import { ArrowRight, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useState } from 'react'
import { GitHubLogo, XLogo } from '../components/Chrome'
import { Pill } from '../components/Status'
import { CLIENT_CONFIG, explorerAddress, GITHUB_URL, X_HANDLE, X_URL } from '../config'
import { api, ApiError } from '../lib/api'
import { formatNumber } from '../lib/hooks'
import { usePageMeta } from '../lib/meta'
import { useRuntime } from '../lab/runtime'
import { NET, useRegistrationLabel } from '../lib/networkCopy'
import { copyText } from '../lib/toast'
import { shortAddress } from '../protocol/address'
import { BURN_OPERATIONS, type BurnOperationSpec } from '../protocol/burnEngine'
import { PQ_MODULES } from '../protocol/modules'
import { baseExplorerAddress, type BaseNetwork } from '../protocol/base'
import { CHAIN_BURN_SCALE, formatBaseUnits, PRICING } from '../protocol/pricing'
import { Link } from '../router'
import { FinalWord } from './Home'

interface TokenResponse {
  status: 'PRELAUNCH' | 'LIVE'
  network: string
  mint: string | null
  token: { mint: string; tokenProgram: string; decimals: number; supplyRaw: string; mintAuthority: string | null; freezeAuthority: string | null } | null
  market: { bondingCurve: string; complete: boolean; priceSol: number | null; marketCapSol: number | null; curveSolRaw: string; creator: string | null; tradingLink: string } | null
  marketError?: string | null
  tradingLink?: string | null
  protocol: { burnedRaw: string; burnCount: number; source: string } | null
  base?: BaseToken
  fetchedAt: string
  cached?: boolean
}

interface BaseToken {
  status: 'PRELAUNCH' | 'LIVE'
  network: BaseNetwork
  token: string | null
  decimals?: number | null
  supplyRaw?: string | null
  clankerUrl?: string | null
  error?: string | null
  protocol: { burnedWhole: string; burnCount: number; source: string } | null
}

type Load = { state: 'loading' } | { state: 'ok'; data: TokenResponse } | { state: 'error'; message: string }

const BRIEF = `QUANTUM FORK ($QFORK)
POST-QUANTUM BLOCKCHAIN LAB

Build for the quantum future. No code required.
Choose what to build: a chain, a vault, a payment network, a private network or an AI economy. Burn $QFORK to launch it.

$QFORK is burned, never sent to a wallet: the token's own burn() on Base, the SPL burn instruction on Solana. Supply goes down.
Nothing here is a promise of returns.

${CLIENT_CONFIG.siteUrl}
${X_URL}`

const REACTION_COLOR: Record<BurnOperationSpec['id'], string> = { GENESIS: 'var(--lime)', FORK: 'var(--cyan)', MUTATION: 'var(--orange)', APPLICATION_MODULE: 'var(--purple)' }

const REACTIONS = BURN_OPERATIONS.map((operation) => ({
  ...operation,
  ...(operation.id === 'GENESIS' && NET.mainnet ? { detail: 'Registers a new descendant by burning $QFORK.' } : {}),
  color: REACTION_COLOR[operation.id],
}))

/** Burn amounts scale with the chain's supply: Base burns are CHAIN_BURN_SCALE.base× the Solana amounts. */
function reactionInput(operation: BurnOperationSpec, scale: number) {
  if (operation.base !== null) return `${formatNumber(operation.base * scale)} QFORK + modules`
  if (operation.id === 'MUTATION') return `${formatNumber(Math.min(...PQ_MODULES.map((m) => m.burn)) * scale)}+ QFORK`
  return 'Not priced'
}

function ReactionPill({ status }: { status: string }) {
  return <Pill label={status} tone={status === 'TESTNET' ? 'var(--cyan)' : status === 'MAINNET' ? 'var(--green)' : 'var(--faint)'} />
}

function useToken() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const refresh = useCallback(() => {
    setLoad({ state: 'loading' })
    api<TokenResponse>('/api/token', { timeoutMs: 10_000 })
      .then(({ data }) => setLoad({ state: 'ok', data }))
      .catch((error) => setLoad({ state: 'error', message: error instanceof ApiError ? error.message : 'Token data is unavailable.' }))
  }, [])
  useEffect(refresh, [refresh])
  return { load, refresh }
}

export default function QFork() {
  usePageMeta({ title: '$QFORK', description: '$QFORK is burned to launch post-quantum descendants. Live token data, burn mechanics and risks.', path: '/qfork' })
  const { load, refresh } = useToken()
  const data = load.state === 'ok' ? load.data : null
  const live = data?.status === 'LIVE'
  const prelaunch = CLIENT_CONFIG.tokenStatus !== 'LIVE' || data?.status === 'PRELAUNCH'
  const tradingLink = live ? (data?.tradingLink ?? data?.market?.tradingLink ?? null) : null
  const mint = live ? data?.mint : null
  const decimals = data?.token?.decimals ?? PRICING.decimals
  const base = data?.base ?? null
  const baseLive = base?.status === 'LIVE' && Boolean(base.token)
  const baseName = base?.network === 'base-sepolia' ? 'Base Sepolia' : 'Base'
  const registration = useRegistrationLabel()
  const { burnChain } = useRuntime()
  const clankerUrl = baseLive ? (base?.clankerUrl ?? null) : null
  const baseLine = baseLive && base?.token && (
    <p className="mint-line">
      {baseName.toUpperCase()}{' '}
      <a href={baseExplorerAddress(base.token, base.network)} target="_blank" rel="noreferrer noopener">
        <code>{base.token}</code>
      </a>
      <button type="button" className="icon-btn" aria-label="Copy Base contract address" onClick={() => void copyText(base.token ?? '', 'Base contract address copied.')}>
        <Copy size={13} strokeWidth={1.8} />
      </button>
    </p>
  )

  return (
    <div className="token-page">
      <section className="token-hero">
        <div className="token-copy">
          <p className="eyebrow">
            Material data sheet · QF-MSDS-02 · <Pill label={baseLive ? `LIVE · ${baseName.toUpperCase()}` : prelaunch ? 'TOKEN LAUNCH PENDING' : `LIVE · ${data?.network ?? CLIENT_CONFIG.network}`} tone={baseLive || !prelaunch ? 'var(--green)' : 'var(--orange)'} />
          </p>
          <h1>$QFORK</h1>
          <p className="token-sub">The fuel that launches a descendant.</p>
          <p className="section-lede">
            $QFORK is burned to commission a post-quantum descendant. On Base a burn is the token’s own burn() function; on Solana it is the SPL burn instruction. Either way
            tokens are destroyed and total supply falls. It is never a transfer to a “dead” wallet.
          </p>
          <div className="hero-ctas">
            {clankerUrl && (
              <a href={clankerUrl} target="_blank" rel="noreferrer noopener" className="btn btn-primary btn-lg">
                Trade on Clanker <ExternalLink size={15} strokeWidth={1.8} />
              </a>
            )}
            {tradingLink ? (
              <a href={tradingLink} target="_blank" rel="noreferrer noopener" className={`btn ${clankerUrl ? 'btn-secondary' : 'btn-primary'} btn-lg`}>
                Trade on Pump.fun <ExternalLink size={15} strokeWidth={1.8} />
              </a>
            ) : (
              !clankerUrl && (
                <button type="button" className="btn btn-primary btn-lg" disabled>
                  Token launch pending
                </button>
              )
            )}
            <a href={X_URL} target="_blank" rel="noreferrer noopener" className="btn btn-secondary btn-lg">
              <XLogo size={14} /> Follow @{X_HANDLE}
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="btn btn-secondary btn-lg">
              <GitHubLogo size={14} /> Source on GitHub
            </a>
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => void copyText(BRIEF, 'Launch brief copied.')}>
              <Copy size={15} strokeWidth={1.8} /> Copy brief
            </button>
          </div>
          {baseLine}
          {mint && (
            <p className="mint-line">
              {baseLine ? 'SOLANA' : 'MINT'}{' '}
              <a href={explorerAddress(mint)} target="_blank" rel="noreferrer noopener">
                <code>{mint}</code>
              </a>
              <button type="button" className="icon-btn" aria-label="Copy mint address" onClick={() => void copyText(mint, 'Mint address copied.')}>
                <Copy size={13} strokeWidth={1.8} />
              </button>
            </p>
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="live-title">
        <header className="section-head section-head-row">
          <div>
            <p className="eyebrow">Token data · {live || baseLive ? 'from the chain' : 'none yet'}</p>
            <h2 id="live-title">{baseLive ? 'Read from the chain, not from us.' : live ? 'Read from Solana, not from us.' : 'No price. No chart. Not yet.'}</h2>
          </div>
          <button type="button" className="btn btn-quiet btn-sm" onClick={refresh} disabled={load.state === 'loading'}>
            <RefreshCw size={13} strokeWidth={1.8} /> Refresh
          </button>
        </header>
        {load.state === 'loading' && <div className="data-panel panel is-loading" aria-busy="true" />}
        {load.state === 'error' && (
          <div className="data-panel panel">
            <p className="field-error">{load.message}</p>
            <p className="muted">Nothing is shown rather than a stale or invented number.</p>
          </div>
        )}
        {data && !live && (
          <div className="data-panel panel">
            <p>
              $QFORK has not launched. Until it does, this page shows no price, market cap, holder count or chart, and nothing in the lab burns real tokens. When it launches on
              Pump.fun, the mint is set in one place and every number here is read from the chain.
            </p>
          </div>
        )}
        {data && live && data.token && (
          <div className="data-grid">
            <dl className="facts panel">
              <div>
                <dt>Total supply</dt>
                <dd>{formatBaseUnits(data.token.supplyRaw, decimals)}</dd>
              </div>
              <div>
                <dt>Decimals</dt>
                <dd>{data.token.decimals}</dd>
              </div>
              <div>
                <dt>Mint authority</dt>
                <dd>{data.token.mintAuthority ? shortAddress(data.token.mintAuthority) : 'REVOKED'}</dd>
              </div>
              <div>
                <dt>Freeze authority</dt>
                <dd>{data.token.freezeAuthority ? shortAddress(data.token.freezeAuthority) : 'NONE'}</dd>
              </div>
              <div>
                <dt>Token program</dt>
                <dd>{shortAddress(data.token.tokenProgram)}</dd>
              </div>
            </dl>
            <dl className="facts panel">
              {data.market ? (
                <>
                  <div>
                    <dt>Bonding curve</dt>
                    <dd>{data.market.complete ? 'COMPLETE · GRADUATED' : 'ACTIVE'}</dd>
                  </div>
                  <div>
                    <dt>Curve price</dt>
                    <dd>{data.market.priceSol === null ? '—' : `${data.market.priceSol.toPrecision(4)} SOL`}</dd>
                  </div>
                  <div>
                    <dt>Curve market cap</dt>
                    <dd>{data.market.marketCapSol === null ? '—' : `${formatNumber(data.market.marketCapSol)} SOL`}</dd>
                  </div>
                  <div>
                    <dt>SOL in curve</dt>
                    <dd>{(Number(data.market.curveSolRaw) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 })}</dd>
                  </div>
                  {data.market.creator && (
                    <div>
                      <dt>Creator</dt>
                      <dd>{shortAddress(data.market.creator)}</dd>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <dt>Market</dt>
                  <dd>{data.marketError ?? 'Pump market data is switched off (ENABLE_PUMPFUN_DATA=false).'}</dd>
                </div>
              )}
            </dl>
            <p className="data-source">
              SOURCE: SOLANA RPC · {data.market ? 'PUMP BONDING CURVE ACCOUNT · ' : ''}FETCHED {data.fetchedAt.replace('T', ' ').slice(0, 19)} UTC{data.cached ? ' · CACHED ≤30S' : ''}
            </p>
          </div>
        )}
        {data?.protocol && (
          <dl className="facts panel protocol-stats">
            <div>
              <dt>Verified burns</dt>
              <dd>{formatNumber(data.protocol.burnCount)}</dd>
            </div>
            <div>
              <dt>QFORK burned via the lab</dt>
              <dd>{formatBaseUnits(data.protocol.burnedRaw, decimals)}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{data.network}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>Server-verified receipts</dd>
            </div>
          </dl>
        )}
        {base && !baseLive && (
          <div className="data-panel panel">
            <p>
              $QFORK has not launched on {baseName} yet. It will launch through Clanker; until then nothing on Base burns real tokens and no Base numbers are shown. The contract
              address is set in one place on the server.
            </p>
          </div>
        )}
        {base && baseLive && (
          <div className="data-grid">
            <dl className="facts panel">
              <div>
                <dt>Base total supply</dt>
                <dd>{base.supplyRaw && base.decimals != null ? formatBaseUnits(base.supplyRaw, base.decimals) : '—'}</dd>
              </div>
              <div>
                <dt>Decimals</dt>
                <dd>{base.decimals ?? '—'}</dd>
              </div>
              <div>
                <dt>Verified burns on {baseName}</dt>
                <dd>{base.protocol ? formatNumber(base.protocol.burnCount) : '—'}</dd>
              </div>
              <div>
                <dt>QFORK burned via the lab</dt>
                <dd>{base.protocol ? formatNumber(Number(base.protocol.burnedWhole)) : '—'}</dd>
              </div>
            </dl>
            <p className="data-source">{base.error ?? `SOURCE: ${baseName.toUpperCase()} RPC · totalSupply() ON THE TOKEN CONTRACT`}</p>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="reactions-title">
        <header className="section-head">
          <p className="eyebrow">Known reactions · {burnChain === 'base' ? 'Base amounts · ' : ''}pricing {PRICING.status.toLowerCase()}</p>
          <h2 id="reactions-title">What burns QFORK.</h2>
        </header>
        <ol className="reactions">
          {REACTIONS.map((reaction) => (
            <li key={reaction.code} className="panel" style={{ '--c': reaction.color } as CSSProperties}>
              <span className="reaction-code">{reaction.code}</span>
              <ReactionPill status={reaction.id === 'GENESIS' && NET.mainnet ? registration : reaction.status} />
              <h3>{reaction.name}</h3>
              <p className="equation">
                <span>{reactionInput(reaction, CHAIN_BURN_SCALE[burnChain])}</span>
                <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
                <span className="equation-out">{reaction.output}</span>
              </p>
              <p className="reaction-note">{reaction.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section infra" aria-labelledby="terms-title">
        <div className="infra-copy">
          <p className="eyebrow">Plain terms</p>
          <h2 id="terms-title">What $QFORK is, and isn’t.</h2>
          <ul className="notes">
            <li>A utility token burned to launch descendants in the lab. Not equity, not a claim on revenue, not a promise of returns.</li>
            <li>
              {NET.mainnet
                ? 'A descendant is registered by burning $QFORK. The burn is permanent and nothing is sent to a wallet.'
                : 'Mainnet registration is not open yet. Today a descendant is registered by burning devnet test QFORK, which has no value.'}
            </li>
            <li>A burn is credited only after the server verifies it on-chain: at finalized commitment on Solana, in a finalized block on Base.</li>
            <li>The Base token has 100× the supply of the Solana token, so Base burns are 100× larger and take the same share of supply.</li>
            <li>Post-quantum modules are designs, not shipped code. A descendant is post-quantum oriented, not quantum-proof.</li>
          </ul>
        </div>
        <dl className="facts panel">
          <div>
            <dt>Ticker</dt>
            <dd>$QFORK</dd>
          </div>
          <div>
            <dt>Chains</dt>
            <dd>Base · Solana</dd>
          </div>
          <div>
            <dt>Launch</dt>
            <dd>Clanker{baseLive ? '' : ' (pending)'} · Pump.fun</dd>
          </div>
          <div>
            <dt>Base contract</dt>
            <dd>{baseLive && base?.token ? shortAddress(base.token, 6, 6) : 'Published at launch'}</dd>
          </div>
          <div>
            <dt>Solana mint</dt>
            <dd>{mint ? shortAddress(mint, 6, 6) : 'Published at launch'}</dd>
          </div>
          <div>
            <dt>Burn mechanism</dt>
            <dd>ERC-20 burn() + tag · SPL BurnChecked + memo</dd>
          </div>
        </dl>
      </section>

      <section className="section cta-band panel">
        <div>
          <p className="eyebrow">{NET.mainnet ? 'Register a descendant' : 'Try it on devnet'}</p>
          <h2>{NET.mainnet ? 'Design it in the lab, then burn $QFORK to register it.' : 'Free test QFORK from the faucet registers a real descendant.'}</h2>
        </div>
        <Link to="/lab" className="btn btn-primary btn-lg">
          Open the lab <ArrowRight size={16} strokeWidth={1.8} />
        </Link>
      </section>

      <FinalWord />
    </div>
  )
}
