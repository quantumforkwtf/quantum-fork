import { useMemo, useState } from 'react'
import { ConsoleSection } from '../../components/network/Parts'
import SourceList from '../../components/SourceList'
import { ModuleBadge, Pill } from '../../components/Status'
import { SpecimenViewport } from '../../components/Viewports'
import type { OrganPart } from '../../lab/morphology'
import { type TabProps, useNetworkGenome } from '../../lib/networkUi'
import { type CategoryCode, LOCUS_BY_CODE } from '../../protocol/ancestors'
import { genomeDiff, remainingExposure } from '../../protocol/descendant'
import { MODULE_BY_ID, type ModuleStatus, type PqModuleId, profileStatus } from '../../protocol/modules'
import { PROFILE_BY_ID, strainLabel } from '../../protocol/profiles'
import type { SourceId } from '../../protocol/sources'

const LOCUS_LABEL: Record<CategoryCode, string> = {
  SIG: 'Signatures',
  KEY: 'Key architecture',
  HSH: 'Hashing',
  TXA: 'Transaction authorization',
  VAL: 'Validator identity',
  WLT: 'Wallet compatibility',
  BRG: 'Bridge dependencies',
  RCV: 'Recovery',
  PRF: 'Privacy',
  EXT: 'Transport',
}

interface Property {
  id: string
  code: string
  label: string
  current: string
  ancestor: string
  changed: boolean
  change: string
  why: string
  statuses: ModuleStatus[]
  implementation: string
  limitations: string[]
  sources: SourceId[]
  part: OrganPart | null
}

const uniq = <T,>(items: T[]) => [...new Set(items)]

export function Cryptography({ view }: TabProps) {
  const { config } = view
  const genome = useNetworkGenome(view)
  const [selected, setSelected] = useState<string>('SIG')
  const remaining = remainingExposure(config)

  const properties = useMemo<Property[]>(() => {
    const modulesOf = (ids: PqModuleId[]) => ids.map((id) => MODULE_BY_ID[id])
    const loci = genomeDiff(config).map((row): Property => {
      const locus = LOCUS_BY_CODE[row.code]
      const modules = modulesOf(row.modules)
      const limitations = modules.map((module) => module.warning).filter((line): line is string => Boolean(line))
      if (!row.changed) limitations.push(locus.consideration)
      if (row.code === 'PRF' && config.privacy === 'shielded') limitations.push('Confidential balances use classical proofs. They are not post-quantum.')
      return {
        id: row.code,
        code: row.code,
        label: LOCUS_LABEL[row.code],
        current: row.descendant,
        ancestor: row.ancestor,
        changed: row.changed,
        change: row.changed ? modules.map((module) => `${module.code} ${module.name}`).join(' + ') : 'None. Inherited from Solana unchanged.',
        why: locus.why,
        statuses: uniq(modules.map((module) => module.status)),
        implementation: modules.length ? uniq(modules.map((module) => module.implementation)).join(' ') : 'Inherited from the ancestor’s clients.',
        limitations,
        sources: uniq([...locus.sources, ...modules.flatMap((module) => module.documentation)]),
        part: locus.part,
      }
    })
    const profile = PROFILE_BY_ID[config.profile]
    const status = profileStatus(config)
    const agility = config.modules.includes('cag') ? MODULE_BY_ID.cag : null
    return [
      ...loci,
      {
        id: 'PQP',
        code: 'PQP',
        label: 'PQ profile',
        current: `${strainLabel(profile)} · ${profile.summary}`,
        ancestor: 'None: classical cryptography',
        changed: config.modules.length > 0,
        change: `${config.modules.length} module${config.modules.length === 1 ? '' : 's'}: ${config.modules.map((id) => MODULE_BY_ID[id].code).join(', ') || 'none'}`,
        why: 'The profile is the set of post-quantum changes made at genesis. It decides which classical exposures remain.',
        statuses: status ? [status] : [],
        implementation: 'Every module is a design specification. None is implemented.',
        limitations: [profile.warning, `${remaining.length} classical loc${remaining.length === 1 ? 'us remains' : 'i remain'}: ${remaining.map((row) => row.code).join(', ') || 'none'}.`].filter((line): line is string => Boolean(line)),
        sources: uniq(config.modules.flatMap((id) => MODULE_BY_ID[id].documentation)),
        part: null,
      },
      {
        id: 'CAG',
        code: 'CAG',
        label: 'Crypto agility',
        current: agility ? agility.summary : 'None. Swapping primitives later needs a hard fork.',
        ancestor: 'No suite identifiers',
        changed: Boolean(agility),
        change: agility ? `${agility.code} ${agility.name}` : 'None',
        why: 'Agility lets a network move to a new primitive at a planned height instead of a disruptive fork.',
        statuses: agility ? [agility.status] : [],
        implementation: agility?.implementation ?? '—',
        limitations: agility?.warning ? [agility.warning] : [],
        sources: agility?.documentation ?? [],
        part: agility?.part ?? null,
      },
    ]
  }, [config, remaining])

  const property = properties.find((item) => item.id === selected) ?? properties[0]
  const fx = useMemo(() => ({ exposed: remaining.map((row) => LOCUS_BY_CODE[row.code].part), alert: 0.45, lattice: view.lattice, scan: 0 }), [remaining, view.lattice])

  return (
    <>
      <header className="nc-tab-head">
        <div>
          <h2>Cryptographic genome</h2>
          <p className="section-lede">The organism is drawn from this network’s live configuration: post-quantum changes glow, classical exposures stay red. Choose a property to see what changed and why.</p>
        </div>
      </header>

      <div className="nc-genome">
        <div className="nc-genome-stage">
          <SpecimenViewport genome={genome} highlight={property.part} fx={fx} layers={view.layers} zoom={1.08} className="nc-organism-view" label={`${view.code} genome organism`} />
        </div>
        <ul className="nc-props" role="listbox" aria-label="Genome properties">
          {properties.map((item) => (
            <li key={item.id}>
              <button type="button" role="option" aria-selected={item.id === property.id} className={`organ-row ${item.changed ? 'is-changed' : 'is-classical'} ${item.id === property.id ? 'is-on' : ''}`} onClick={() => setSelected(item.id)}>
                <code>{item.code}</code>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.current}</small>
                </span>
                <i>{item.changed ? 'PQ' : 'CLASSICAL'}</i>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ConsoleSection code={property.code} title={property.label} className="is-wide">
        <dl className="report">
          <div>
            <dt>Current</dt>
            <dd>{property.current}</dd>
          </div>
          <div>
            <dt>Ancestor</dt>
            <dd>{property.ancestor}</dd>
          </div>
          <div>
            <dt>Change</dt>
            <dd>{property.change}</dd>
          </div>
          <div>
            <dt>Why</dt>
            <dd>{property.why}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd className="nc-badges">{property.statuses.length ? property.statuses.map((status) => <ModuleBadge key={status} status={status} />) : <Pill label="CLASSICAL" tone="var(--red)" />}</dd>
          </div>
          <div>
            <dt>Implementation</dt>
            <dd>{property.implementation}</dd>
          </div>
          <div>
            <dt>Known limitations</dt>
            <dd>
              {property.limitations.length ? (
                <ul className="notes">
                  {property.limitations.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        {property.sources.length > 0 && (
          <>
            <p className="mono-label">Sources</p>
            <SourceList ids={property.sources} compact />
          </>
        )}
      </ConsoleSection>
    </>
  )
}
