import { ArrowRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { LaunchToken } from '../components/network/LaunchToken'
import FailurePanel from '../components/FailurePanel'
import { OriginBadge } from '../components/Status'
import { explorerTx, isMainnetNetwork } from '../config'
import { formatNumber } from '../lib/hooks'
import { usePageMeta } from '../lib/meta'
import { navigate, useLocation } from '../navigation'
import { type ConsoleView, NETWORK_TABS, networkHref, type NetworkTab, type TabProps, timestamp, useNetwork } from '../lib/networkUi'
import { PROFILE_BY_ID, strainLabel } from '../protocol/profiles'
import { Link } from '../router'
import { Cryptography } from './network/Cryptography'
import { Developers } from './network/Developers'
import { Overview } from './network/Overview'
import { Tokens } from './network/Tokens'

const clusterName = (cluster: string) =>
  cluster === 'mainnet-beta' ? 'Mainnet' : cluster === 'base' ? 'Base' : cluster === 'base-sepolia' ? 'Base Sepolia' : cluster[0].toUpperCase() + cluster.slice(1)

function Metrics({ view }: { view: ConsoleView }) {
  const receipt = view.descendant.receipt
  const cells = [
    { label: 'Registered', value: view.registeredAt ? timestamp(view.registeredAt).slice(0, 10) : '—', note: 'server record' },
    {
      label: 'QFORK burned',
      value: receipt ? formatNumber(receipt.amount) : '—',
      note: receipt ? (
        <a href={explorerTx(receipt.signature, view.network)} target="_blank" rel="noreferrer">
          {isMainnetNetwork(view.network) ? 'verified on-chain' : 'test QFORK · verified'}
        </a>
      ) : (
        'not verified'
      ),
    },
    { label: 'Tokens', value: String(view.tokens.length), note: 'verified on-chain' },
    { label: 'Forks', value: String(view.forks.length), note: 'registered descendants' },
    { label: view.chain === 'base' ? 'Network' : 'Cluster', value: clusterName(view.network), note: 'where the burn and tokens live' },
    { label: 'Running chain', value: 'Not built', note: <span className="nc-tag is-off">NO VALIDATORS</span> },
  ]
  return (
    <dl className="nc-metrics" aria-label="Descendant records">
      {cells.map((cell) => (
        <div key={cell.label}>
          <dt>{cell.label}</dt>
          <dd>{cell.value}</dd>
          <small className="nc-metric-note">{cell.note}</small>
        </div>
      ))}
    </dl>
  )
}

function Unavailable({ title, children, cta }: { title: string; children: React.ReactNode; cta?: React.ReactNode }) {
  return (
    <div className="page-head not-found">
      <p className="eyebrow">Descendant console</p>
      <h1>{title}</h1>
      <p className="section-lede">{children}</p>
      {cta ?? (
        <Link to="/network" className="btn btn-primary">
          Your descendants
        </Link>
      )}
    </div>
  )
}

export default function NetworkConsole({ id, tab }: { id: string; tab: NetworkTab }) {
  const { descendant, view, error, loading } = useNetwork(id)
  const [launching, setLaunching] = useState(false)

  usePageMeta({
    title: view ? `${view.code} · ${NETWORK_TABS.find((item) => item.id === tab)?.label} · Descendant console` : 'Descendant console',
    description: 'A registered Quantum Fork descendant: its burn receipt, its tokens, its developer kit and its cryptography.',
    path: networkHref(id, tab),
  })

  const close = useCallback(() => setLaunching(false), [])

  const { path, query } = useLocation()
  const askedToLaunch = query.get('launch') === '1'
  const owned = Boolean(view?.owned)
  useEffect(() => {
    if (!askedToLaunch || !owned) return
    setLaunching(true)
    navigate(path, { replace: true, keepScroll: true })
  }, [askedToLaunch, owned, path])

  if (loading) return <Unavailable title="Loading descendant…">Fetching the registration record from the server.</Unavailable>
  if (!descendant) {
    return (
      <div className="page-head not-found">
        <p className="eyebrow">Descendant console</p>
        <h1>No such descendant.</h1>
        {error && <FailurePanel error={error} />}
        <p className="section-lede">Descendants exist once a QFORK burn for them is verified by the server.</p>
        <Link to="/network" className="btn btn-primary">
          Your descendants
        </Link>
      </div>
    )
  }
  if (descendant.origin === 'ancestor')
    return (
      <Unavailable
        title="Solana is the ancestor."
        cta={
          <Link to="/species/solana" className="btn btn-primary">
            Ancestor report
          </Link>
        }
      >
        Quantum Fork does not operate Solana. Its descendants are registered designs derived from it.
      </Unavailable>
    )
  if (!view)
    return (
      <Unavailable
        title="Example data, not a descendant."
        cta={
          <Link to="/lab?blueprint=quantum-chain" className="btn btn-primary">
            Design one <ArrowRight size={15} strokeWidth={1.8} />
          </Link>
        }
      >
        {descendant.code} illustrates a configuration. Nothing was burned for it, so there is nothing to open.
      </Unavailable>
    )

  const profile = PROFILE_BY_ID[view.config.profile]
  const props: TabProps = { view, launch: () => setLaunching(true) }

  return (
    <div className="nc-page">
      <header className="nc-head">
        <div className="nc-head-text">
          <p className="eyebrow">
            Descendant console · <Link to={`/species/${view.id}`}>{view.code}</Link> · <OriginBadge origin={descendant.origin} />
          </p>
          <h1>{view.config.network.name}</h1>
          <p className="nc-meta">
            <span>{view.code}</span>
            <span>{strainLabel(profile)}</span>
            <span>GEN-{descendant.generation}</span>
            <span>Ancestor Solana</span>
            <span className="nc-online">
              <i aria-hidden="true" /> Registered · {clusterName(view.network)}
            </span>
          </p>
        </div>
        <div className="nc-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => setLaunching(true)} disabled={!view.owned} title={view.owned ? undefined : 'Connect the wallet that burned for this descendant'}>
            Launch a token <ArrowRight size={15} strokeWidth={1.8} />
          </button>
          <Link to={networkHref(view.id, 'developers')} className="btn btn-secondary">
            Developer kit →
          </Link>
          <Link to={`/species/${view.id}`} className="btn btn-secondary">
            Public page →
          </Link>
        </div>
      </header>

      <Metrics view={view} />

      <nav className="nc-tabs" aria-label="Descendant console">
        {NETWORK_TABS.map((item) => (
          <Link key={item.id} to={networkHref(view.id, item.id)} className={item.id === tab ? 'is-on' : ''} aria-current={item.id === tab ? 'page' : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="nc-body">
        {tab === 'overview' && <Overview {...props} />}
        {tab === 'tokens' && <Tokens {...props} />}
        {tab === 'developers' && <Developers {...props} />}
        {tab === 'cryptography' && <Cryptography {...props} />}
      </div>

      {launching && <LaunchToken view={view} onClose={close} />}
    </div>
  )
}
