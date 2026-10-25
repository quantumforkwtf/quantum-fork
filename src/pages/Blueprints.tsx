import { ArrowRight } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { BlueprintCard, BlueprintStage, StatusLegend } from '../components/Blueprint'
import { useMediaQuery, usePrefersReducedMotion } from '../lib/hooks'
import { usePageMeta } from '../lib/meta'
import { BLUEPRINT_GROUPS, BLUEPRINTS, type Blueprint } from '../protocol/blueprints'
import { Link } from '../router'

interface Hover {
  blueprint: Blueprint
  rect: { top: number; left: number; width: number; height: number }
}

/** One live specimen scene, moved over whichever card is active. Every card is otherwise a cached snapshot. */
function useLiveStage() {
  const container = useRef<HTMLDivElement>(null)
  const thumbs = useRef(new Map<string, HTMLSpanElement>())
  const [hover, setHover] = useState<Hover | null>(null)
  const [visible, setVisible] = useState(false)
  const fine = useMediaQuery('(hover: hover) and (pointer: fine) and (min-width: 900px)')
  const reduced = usePrefersReducedMotion()
  const live = fine && !reduced

  const activate = useCallback(
    (blueprint: Blueprint) => {
      const node = thumbs.current.get(blueprint.slug)
      const root = container.current
      if (!live || !node || !root) return
      const a = node.getBoundingClientRect()
      const b = root.getBoundingClientRect()
      setHover({ blueprint, rect: { top: a.top - b.top, left: a.left - b.left, width: a.width, height: a.height } })
      setVisible(true)
    },
    [live],
  )

  const register = (slug: string) => (node: HTMLSpanElement | null) => {
    if (node) thumbs.current.set(slug, node)
    else thumbs.current.delete(slug)
  }

  return { container, hover: live ? hover : null, visible, activate, register, clear: () => setVisible(false) }
}

export default function Blueprints() {
  usePageMeta({
    title: 'Blueprints',
    description: 'Choose what you want to build. Quantum Fork configures the supported cryptography, network architecture and infrastructure. Every blueprint shows its real status.',
    path: '/blueprints',
    image: '/api/og?page=blueprints',
  })
  const stage = useLiveStage()

  return (
    <div className="blueprints-page">
      <header className="page-head page-head-row">
        <div>
          <p className="eyebrow">Blueprints · No code required</p>
          <h1>
            Build for the <span>quantum future.</span>
          </h1>
          <p className="section-lede">
            Choose what you want to build. Quantum Fork configures the supported cryptography, network architecture and infrastructure. Each blueprint is only as mature as its
            least mature part, and says so.
          </p>
        </div>
        <div className="blueprints-head-actions">
          <Link to="/build" className="btn btn-primary">
            Help me choose <ArrowRight size={15} strokeWidth={1.8} />
          </Link>
          <Link to="/lab?blueprint=custom" className="btn btn-secondary">
            Expert mode
          </Link>
        </div>
      </header>

      <section className="section section-tight">
        <StatusLegend />
      </section>

      <div ref={stage.container} className="blueprints-groups" onPointerLeave={stage.clear}>
        {BLUEPRINT_GROUPS.map((group) => {
          const items = BLUEPRINTS.filter((item) => item.category === group.category)
          return (
            <section key={group.category} className="section section-tight bp-group" aria-labelledby={`group-${group.category}`}>
              <header className="bp-group-head">
                <h2 id={`group-${group.category}`}>{group.title}</h2>
                <p>{group.lede}</p>
              </header>
              <div className={`bp-grid ${group.category === 'EXPERT' ? 'is-single' : ''}`}>
                {items.map((blueprint) => (
                  <BlueprintCard
                    key={blueprint.slug}
                    blueprint={blueprint}
                    active={stage.visible && stage.hover?.blueprint.slug === blueprint.slug}
                    thumbRef={stage.register(blueprint.slug)}
                    onActivate={() => stage.activate(blueprint)}
                  />
                ))}
              </div>
            </section>
          )
        })}
        {stage.hover && (
          <div className={`bp-live ${stage.visible ? 'is-shown' : ''}`} style={stage.hover.rect} aria-hidden="true">
            <BlueprintStage blueprint={stage.hover.blueprint} active={stage.visible} interactive={false} showLabels={false} />
          </div>
        )}
      </div>
    </div>
  )
}
