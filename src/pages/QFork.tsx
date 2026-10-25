import { ArrowRight, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useState } from 'react'
import { GitHubLogo, XLogo } from '../components/Chrome'
import { Pill } from '../components/Status'
import { CLIENT_CONFIG, GITHUB_URL, X_HANDLE, X_URL } from '../config'
import { api, ApiError } from '../lib/api'
import { formatNumber } from '../lib/hooks'
import { usePageMeta } from '../lib/meta'
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

$QFORK is an ERC-20 on Base. It is burned with the token's own burn(), never sent to a wallet. Supply goes down.
Nothing here is a promise of returns.

${CLIENT_CONFIG.siteUrl}
${X_URL}`

const REACTION_COLOR: Record<BurnOperationSpec['id'], string> = { GENESIS: 'var(--lime)', FORK: 'var(--cyan)', MUTATION: 'var(--orange)', APPLICATION_MODULE: 'var(--purple)' }

const SCALE = CHAIN_BURN_SCALE.base

const REACTIONS = BURN_OPERATIONS.map((operation) => ({
  ...operation,
  ...(operation.id === 'GENESIS' && NET.mainnet ? { detail: 'Registers a new descendant by burning $QFORK.' } : {}),
  input:
    operation.base !== null
      ? `${formatNumber(operation.base * SCALE)} QFORK + modules`
      : operation.id === 'MUTATION'
        ? `${formatNumber(Math.min(...PQ_MODULES.map((m) => m.burn)) * SCALE)}+ QFORK`
        : 'Not priced',
  color: REACTION_COLOR[operation.id],
}))

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
  const base = data?.base ?? null
  const live = base?.status === 'LIVE' && Boolean(base.token)
  const token = live ? (base?.token ?? null) : null
  const clankerUrl = live ? (base?.clankerUrl ?? null) : null
  const baseName = base?.network === 'base-sepolia' ? 'Base Sepolia' : 'Base'
  const registration = useRegistrationLabel()

  return (
    <div className="token-page">
      <section className="token-hero">
        <div className="token-copy">
          <p className="eyebrow">
            Material data sheet · QF-MSDS-02 · <Pill label={live ? `LIVE · ${baseName.toUpperCase()}` : 'TOKEN LAUNCH PENDING'} tone={live ? 'var(--green)' : 'var(--orange)'} />
          </p>
          <h1>$QFORK</h1>
          <p className="token-sub">The fuel that launches a descendant.</p>
          <p className="section-lede">
            $QFORK is an ERC-20 on Base. It is burned to commission a post-quantum descendant, with the token’s own burn() function: tokens are destroyed and total supply
            falls. It is never a transfer to a “dead” wallet.
          </p>
          <div className="hero-ctas">
            {clankerUrl ? (
              <a href={clankerUrl} target="_blank" rel="noreferrer noopener" className="btn btn-primary btn-lg">
                Trade on Clanker <ExternalLink size={15} strokeWidth={1.8} />
              </a>
            ) : (
              <button type="button" className="btn btn-primary btn-lg" disabled>
                Token launch pending
              </button>
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
          {token && base && (
            <p className="mint-line">
              {baseName.toUpperCase()}{' '}
              <a href={baseExplorerAddress(token, base.network)} target="_blank" rel="noreferrer noopener">
                <code>{token}</code>
              </a>
              <button type="button" className="icon-btn" aria-label="Copy contract address" onClick={() => void copyText(token, 'Contract address copied.')}>
                <Copy size={13} strokeWidth={1.8} />
              </button>
            </p>
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="live-title">
        <header className="section-head section-head-row">
          <div>
            <p className="eyebrow">Token data · {live ? 'from the chain' : 'none yet'}</p>
            <h2 id="live-title">{live ? `Read from ${baseName}, not from us.` : 'No price. No chart. Not yet.'}</h2>
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
              $QFORK has not launched. It launches on Base through Clanker. Until it does, this page shows no price, market cap, holder count or chart, and nothing in the lab burns
              real tokens. When it launches, the contract address is set in one place on the server and every number here is read from the chain.
            </p>
          </div>
        )}
        {live && base && (
          <div className="data-grid">
            <dl className="facts panel">
              <div>
                <dt>Total supply</dt>
                <dd>{base.supplyRaw && base.decimals != null ? formatBaseUnits(base.supplyRaw, base.decimals) : '—'}</dd>
              </div>
              <div>
                <dt>Decimals</dt>
                <dd>{base.decimals ?? '—'}</dd>
              </div>
              <div>
                <dt>Verified burns</dt>
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
          <p className="eyebrow">Known reactions · pricing {PRICING.status.toLowerCase()}</p>
          <h2 id="reactions-title">What burns QFORK.</h2>
        </header>
        <ol className="reactions">
          {REACTIONS.map((reaction) => {
            const status = reaction.id === 'GENESIS' && NET.mainnet ? registration : reaction.status
            return (
              <li key={reaction.code} className="panel" style={{ '--c': reaction.color } as CSSProperties}>
                <span className="reaction-code">{reaction.code}</span>
                <Pill label={status} tone={status === 'TESTNET' ? 'var(--cyan)' : status === 'MAINNET' ? 'var(--green)' : 'var(--faint)'} />
                <h3>{reaction.name}</h3>
                <p className="equation">
                  <span>{reaction.input}</span>
                  <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
                  <span className="equation-out">{reaction.output}</span>
                </p>
                <p className="reaction-note">{reaction.detail}</p>
              </li>
            )
          })}
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
                : 'Mainnet registration is not open yet. Today a descendant is registered by burning test QFORK, which has no value.'}
            </li>
            <li>A burn is credited only after the server verifies it on-chain, in a finalized block on Base.</li>
            <li>Post-quantum modules are designs, not shipped code. A descendant is post-quantum oriented, not quantum-proof.</li>
          </ul>
        </div>
        <dl className="facts panel">
          <div>
            <dt>Ticker</dt>
            <dd>$QFORK</dd>
          </div>
          <div>
            <dt>Chain</dt>
            <dd>Base</dd>
          </div>
          <div>
            <dt>Launch</dt>
            <dd>Clanker{live ? '' : ' (pending)'}</dd>
          </div>
          <div>
            <dt>Contract</dt>
            <dd>{token ? shortAddress(token, 6, 6) : 'Published at launch'}</dd>
          </div>
          <div>
            <dt>Burn mechanism</dt>
            <dd>ERC-20 burn() + registration tag</dd>
          </div>
        </dl>
      </section>

      <section className="section cta-band panel">
        <div>
          <p className="eyebrow">{NET.mainnet ? 'Register a descendant' : 'Try it on testnet'}</p>
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
