import { ArrowLeft, ArrowRight } from 'lucide-react'
import { type CSSProperties, type ReactNode, useMemo } from 'react'
import {
  ArchitectureReadout,
  BlueprintCard,
  BlueprintStage,
  BlueprintStatusBadge,
  BurnEstimateView,
  CompatibilityTable,
  ComponentList,
  IdealFor,
  PlanSteps,
  WarningList,
} from '../components/Blueprint'
import { blueprintVisual } from '../lab/blueprintVisual'
import { useRuntime } from '../lab/runtime'
import { usePageMeta } from '../lib/meta'
import { compileBlueprint, statusMeaning } from '../protocol/blueprintCompiler'
import { BLUEPRINTS, findBlueprint } from '../protocol/blueprints'
import { Link } from '../router'

function Block({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`bp-block ${wide ? 'is-wide' : ''}`}>
      <h2 className="mono-label">{title}</h2>
      {children}
    </section>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="bp-bullets">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export default function BlueprintDetail({ slug }: { slug: string }) {
  const blueprint = findBlueprint(slug)
  const { devnetBurn, mainnetBurn, burnChain } = useRuntime()
  const compiled = useMemo(() => (blueprint ? compileBlueprint(blueprint, {}, { devnetBurn, mainnetBurn, burnChain }) : null), [blueprint, devnetBurn, mainnetBurn, burnChain])
  usePageMeta({
    title: blueprint ? `${blueprint.name} blueprint` : 'Blueprint not found',
    description: blueprint ? `${blueprint.headline} ${blueprint.description}` : undefined,
    path: `/blueprints/${slug}`,
    image: blueprint ? `/api/og?blueprint=${blueprint.slug}` : undefined,
  })

  if (!blueprint || !compiled) {
    return (
      <div className="page-head not-found">
        <p className="eyebrow">Blueprint · Unknown</p>
        <h1>No blueprint by that name.</h1>
        <Link to="/blueprints" className="btn btn-primary">
          All blueprints
        </Link>
      </div>
    )
  }

  const visual = blueprintVisual(blueprint)
  const { action } = compiled.plan
  const position = BLUEPRINTS.indexOf(blueprint)
  const next = BLUEPRINTS[(position + 1) % BLUEPRINTS.length]

  const cta =
    action.href && action.kind !== 'none' ? (
      <Link to={action.href} className="btn btn-primary btn-lg">
        {action.kind === 'build' ? 'Build this' : action.label} <ArrowRight size={16} strokeWidth={1.8} />
      </Link>
    ) : (
      <button type="button" className="btn btn-primary btn-lg" disabled>
        {action.label}
      </button>
    )

  return (
    <article className="bp-detail" style={{ '--tone': visual.tone } as CSSProperties}>
      <header className="page-head bp-detail-head">
        <p className="eyebrow">
          <Link to="/blueprints">Blueprints</Link> · Blueprint // {blueprint.id}
        </p>
        <div className="bp-detail-hero">
          <div className="bp-detail-copy">
            <div className="bp-detail-tags">
              <BlueprintStatusBadge status={compiled.status} />
              <span className="tag">{blueprint.category === 'NETWORK' ? 'New network' : blueprint.category === 'APPLICATION' ? 'Application · no new chain' : 'Expert mode'}</span>
            </div>
            <h1>{blueprint.name}</h1>
            <p className="bp-detail-headline">{blueprint.headline}</p>
            <p className="section-lede">{blueprint.description}</p>
            <IdealFor items={blueprint.idealFor} />
            <div className="bp-detail-cta">
              {cta}
              <Link to="/blueprints" className="btn btn-secondary btn-lg">
                <ArrowLeft size={15} strokeWidth={1.8} /> All blueprints
              </Link>
            </div>
            <p className="bp-note">{action.note}</p>
          </div>
          <div className="bp-detail-stage panel">
            <BlueprintStage blueprint={blueprint} active />
          </div>
        </div>
      </header>

      <div className="section section-tight bp-detail-body">
        <Block title="What you’re building" wide>
          <p className="bp-lead">{blueprint.building}</p>
        </Block>

        <Block title="What Quantum Fork configures">
          <Bullets items={blueprint.configures} />
        </Block>

        <Block title="Recommended genome">
          <ArchitectureReadout rows={compiled.architecture} compact />
        </Block>

        <Block title="Security model">
          <Bullets items={blueprint.securityModel} />
        </Block>

        <Block title="What remains classical">
          <Bullets items={blueprint.remainsClassical} />
        </Block>

        <Block title={compiled.config ? 'Post-quantum components' : 'Components'} wide>
          {compiled.components.length ? <ComponentList rows={compiled.components} /> : <p className="muted">This blueprint adds no cryptographic components. It reads and reports.</p>}
        </Block>

        <Block title="Infrastructure">
          <Bullets items={blueprint.infrastructure} />
        </Block>

        <Block title="Deployment plan">
          <PlanSteps steps={compiled.plan.steps} />
        </Block>

        <Block title="Compatibility" wide>
          <CompatibilityTable rows={compiled.compatibility.rows} />
        </Block>

        <Block title="Status">
          <div className="bp-status">
            <BlueprintStatusBadge status={compiled.status} />
            <p>{statusMeaning(compiled.status)}</p>
            {compiled.statusLimitedBy.length > 0 && (
              <p className="muted">
                Held at {compiled.status} by: {compiled.statusLimitedBy.join(', ')}.
              </p>
            )}          </div>
        </Block>

        <Block title="Known limitations">
          <Bullets items={blueprint.limitations} />
          <WarningList compiled={compiled} />
        </Block>

        <Block title="Estimated QFORK burn">
          <BurnEstimateView burn={compiled.burn} />
        </Block>

      </div>

      <section className="section bp-detail-foot">
        <div className="bp-detail-final panel">
          <div>
            <p className="mono-label">Blueprint // {blueprint.id}</p>
            <h2>{action.kind === 'build' ? `Build ${blueprint.name}.` : action.kind === 'design' ? `Design ${blueprint.name}.` : blueprint.name}</h2>
            <p className="muted">{action.note}</p>
          </div>
          {cta}
        </div>
        <div className="bp-next">
          <p className="mono-label">Next blueprint</p>
          <BlueprintCard blueprint={next} compact />
        </div>
      </section>
    </article>
  )
}
