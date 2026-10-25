import { ArrowRight } from 'lucide-react'
import { OriginBadge } from '../components/Status'
import { OrganismThumb } from '../components/Viewports'
import { genomeOf, useRegistry } from '../lab/registry'
import { usePageMeta } from '../lib/meta'
import { NET } from '../lib/networkCopy'
import { networkHref } from '../lib/networkUi'
import { PROFILE_BY_ID, strainLabel } from '../protocol/profiles'
import { Link } from '../router'

export default function Networks() {
  usePageMeta({ title: 'Your descendants', description: 'Descendants registered with a verified QFORK burn, and the tokens launched for them.', path: '/network' })
  const registry = useRegistry()
  const registered = registry.filter((item) => item.origin === 'registered' && item.config).reverse()

  return (
    <div className="page-head nc-index">
      <p className="eyebrow">Descendant console</p>
      <div className="page-head-row">
        <div>
          <h1>Your descendants.</h1>
          <p className="section-lede">Each one was registered by a QFORK burn the server verified on-chain. Open one to launch its token and get its developer kit.</p>
        </div>
        <Link to="/lab?blueprint=quantum-chain" className="btn btn-primary">
          Design a descendant <ArrowRight size={15} strokeWidth={1.8} />
        </Link>
      </div>

      {registered.length ? (
        <ul className="nc-index-list">
          {registered.map((item) => (
            <li key={item.id}>
              <Link to={networkHref(item.id)} className="nc-index-item">
                <OrganismThumb genome={genomeOf(item)} size={120} />
                <span>
                  <code>{item.code}</code>
                  <strong>{item.config?.network.name}</strong>
                  <small>
                    {item.config ? strainLabel(PROFILE_BY_ID[item.config.profile]) : ''} · GEN-{item.generation}
                  </small>
                  <small>
                    Registered · {item.tokens.length} token{item.tokens.length === 1 ? '' : 's'}
                  </small>
                </span>
                <OriginBadge origin={item.origin} />
                <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="nc-empty">
          <p className="mono-label">No descendants yet</p>
          <p>
            {NET.mainnet
              ? 'Design one in the Lab, then burn $QFORK to register it.'
              : 'Design one in the Lab, then burn devnet test QFORK to register it. The faucet in the Lab gives you the test tokens.'}
          </p>
          <Link to="/lab?blueprint=quantum-chain" className="btn btn-primary btn-sm">
            Open the Lab <ArrowRight size={13} strokeWidth={1.8} />
          </Link>
        </div>
      )}
    </div>
  )
}
