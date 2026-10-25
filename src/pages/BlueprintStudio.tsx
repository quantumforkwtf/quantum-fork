import { ArrowRight, Download, ScanLine, Share2 } from 'lucide-react'
import { type CSSProperties, useMemo } from 'react'
import { BlueprintConfigurator, BlueprintStage, BlueprintStatusBadge, BurnEstimateView, ComponentList, PlanSteps } from '../components/Blueprint'
import { blueprintVisual } from '../lab/blueprintVisual'
import { usePageMeta } from '../lib/meta'
import { copyText, toast } from '../lib/toast'
import { CLIENT_CONFIG } from '../config'
import { navigate } from '../navigation'
import { type Answers, APP_SCAN_PATH, blueprintLabHref, compileBlueprint } from '../protocol/blueprintCompiler'
import { type Blueprint, COMPONENT_BY_ID } from '../protocol/blueprints'
import { Link } from '../router'

/**
 * Application blueprints. They protect or examine something that already
 * exists, so this page never offers a burn, a tier or a deployment.
 */
export default function BlueprintStudio({ blueprint, answers }: { blueprint: Blueprint; answers: Answers }) {
  usePageMeta({ title: `${blueprint.name} · Studio`, description: blueprint.description, path: `/blueprints/${blueprint.slug}`, image: `/api/og?blueprint=${blueprint.slug}` })
  const compiled = useMemo(() => compileBlueprint(blueprint, answers), [blueprint, answers])
  const visual = blueprintVisual(blueprint)
  const mapping = compiled.genome.components.includes('surface-map')
  const href = blueprintLabHref(blueprint, compiled.answers)

  const answer = (next: Answers) => navigate(blueprintLabHref(blueprint, compileBlueprint(blueprint, next).answers), { replace: true, keepScroll: true })

  const exportMap = () => {
    const map = {
      blueprint: blueprint.id,
      subject: compiled.genome.subject,
      generated: 'In the browser, from self-reported answers. Run the code scanner to check the code itself.',
      surfaces: compiled.genome.components.map((id) => {
        const component = COMPONENT_BY_ID[id]
        return { code: component.code, surface: component.name, change: component.summary, replacement: component.primitive, status: component.status, guidance: component.implementation }
      }),
    }
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${blueprint.slug}.surface-map.json`
    link.click()
    URL.revokeObjectURL(url)
    toast('Surface map exported.')
  }

  const primary = mapping ? (
    <>
      <Link to={APP_SCAN_PATH} className="btn btn-primary">
        <ScanLine size={15} strokeWidth={1.8} /> Scan my code
      </Link>
      <button type="button" className="btn btn-secondary" onClick={exportMap}>
        <Download size={15} strokeWidth={1.8} /> Export surface map
      </button>
    </>
  ) : (
    <button type="button" className="btn btn-primary" disabled title="No vault program exists in this build">
      Deploy · not built
    </button>
  )

  return (
    <div className="studio" style={{ '--tone': visual.tone } as CSSProperties}>
      <header className="page-head">
        <p className="eyebrow">
          <Link to={`/blueprints/${blueprint.slug}`}>Blueprint // {blueprint.id}</Link> · Application studio · No new chain
        </p>
        <div className="studio-title">
          <h1>{blueprint.name}</h1>
          <BlueprintStatusBadge status={compiled.status} />
        </div>
        <p className="section-lede">{blueprint.headline}</p>
      </header>

      <div className="studio-grid">
        <aside className="studio-stage panel">
          <BlueprintStage blueprint={blueprint} active />
          <dl className="studio-facts">
            <div>
              <dt>Subject</dt>
              <dd>{compiled.genome.subject}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>None created</dd>
            </div>
            <div>
              <dt>Burn</dt>
              <dd>None</dd>
            </div>
          </dl>
        </aside>

        <div className="studio-main">
          <BlueprintConfigurator
            compiled={compiled}
            onAnswer={answer}
            primary={primary}
            note={<p className="bp-note">{compiled.plan.action.note}</p>}
          />

          <section className="studio-block">
            <h2 className="mono-label">{mapping ? 'Surface map' : 'Components'}</h2>
            {mapping ? (
              <ol className="surface-map">
                {compiled.genome.components.map((id) => {
                  const component = COMPONENT_BY_ID[id]
                  return (
                    <li key={id}>
                      <code>{component.code}</code>
                      <div>
                        <strong>{component.name}</strong>
                        <p>{component.summary}</p>
                        <p className="muted">
                          Replacement: <b>{component.primitive}</b>. {component.implementation}
                        </p>
                      </div>
                      <BlueprintStatusBadge status={component.status} />
                    </li>
                  )
                })}
              </ol>
            ) : (
              <ComponentList rows={compiled.components} />
            )}
          </section>

          <section className="studio-block">
            <h2 className="mono-label">What happens next</h2>
            <PlanSteps steps={compiled.plan.steps} />
          </section>

          <section className="studio-block">
            <h2 className="mono-label">QFORK</h2>
            <BurnEstimateView burn={compiled.burn} />
          </section>

          <div className="studio-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void copyText(`${CLIENT_CONFIG.siteUrl}${href}`, 'Studio link copied.')}>
              <Share2 size={14} strokeWidth={1.8} /> Copy link to this configuration
            </button>
            <Link to={`/blueprints/${blueprint.slug}`} className="btn btn-quiet">
              Read the full blueprint <ArrowRight size={14} strokeWidth={1.8} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
