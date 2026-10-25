import { useMemo } from 'react'
import { networkHref, type ConsoleView, type NetworkTab, useNetworkGenome } from '../../lib/networkUi'
import { Link } from '../../router'
import { NO_FX } from '../../three/types'
import { SpecimenViewport } from '../Viewports'

/** The descendant's organism, with one orbit per verified token and one bud per registered fork. */
export function NetworkOrganism({ view }: { view: ConsoleView }) {
  const genome = useNetworkGenome(view)
  const fx = useMemo(() => ({ ...NO_FX, lattice: view.lattice }), [view.lattice])
  const systems: { tab: NetworkTab; label: string; value: string; note: string }[] = [
    { tab: 'tokens', label: 'Tokens', value: String(view.tokens.length), note: view.tokens.length ? 'verified on-chain' : 'none yet' },
    { tab: 'overview', label: 'Forks', value: String(view.forks.length), note: 'registered' },
    { tab: 'developers', label: 'Developers', value: 'Kit', note: 'config + CLI' },
    { tab: 'cryptography', label: 'Genome', value: String(view.config.modules.length), note: 'PQ modules' },
  ]
  return (
    <div className="nc-organism">
      <SpecimenViewport genome={genome} layers={view.layers} fx={fx} zoom={1.12} className="nc-organism-view" label={`${view.code} organism: ${view.layers.length} structure${view.layers.length === 1 ? '' : 's'} grown from its tokens and forks. Drag to rotate.`} />
      <ul className="nc-systems">
        {systems.map((system, index) => (
          <li key={system.label} className={`at-${index}`}>
            <Link to={networkHref(view.id, system.tab)}>
              <code>{system.label}</code>
              <b>{system.value}</b>
              <small>{system.note}</small>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
