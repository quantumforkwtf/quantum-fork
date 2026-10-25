import { ArrowRight, Check, SkipForward } from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'
import { blueprintVisual, STATUS_TONE } from '../lab/blueprintVisual'
import { assemblySeen, markAssemblySeen } from '../lab/runtime'
import { formatNumber, usePrefersReducedMotion } from '../lib/hooks'
import { NET } from '../lib/networkCopy'
import type { Answers, ArchitectureRow, CompiledBlueprint, ComponentRow, PlanStep } from '../protocol/blueprintCompiler'
import { recommendedStatus, statusMeaning } from '../protocol/blueprintCompiler'
import { BLUEPRINT_STATUSES, type Blueprint, type BlueprintStatus, type CompatibilityRow } from '../protocol/blueprints'
import type { BurnEstimate } from '../protocol/burnEngine'
import type { DescendantConfig } from '../protocol/descendant'
import { Link } from '../router'
import type { SpecimenMode } from '../three/types'
import { Pill } from './Status'
import { OrganismThumb, SpecimenViewport } from './Viewports'

export function BlueprintStatusBadge({ status }: { status: BlueprintStatus }) {
  return <Pill label={status} tone={STATUS_TONE[status]} title={statusMeaning(status)} />
}

export function StatusLegend() {
  return (
    <ul className="bp-legend" aria-label="What each status means">
      {BLUEPRINT_STATUSES.filter((item) => !(NET.mainnet && item.status === 'TESTNET')).map((item) => (
        <li key={item.status}>
          <BlueprintStatusBadge status={item.status} />
          <span>{item.meaning}</span>
        </li>
      ))}
    </ul>
  )
}

/** A blueprint as a card, drawn by the shared snapshot renderer: no WebGL context of its own. */
export function BlueprintCard({
  blueprint,
  to,
  onActivate,
  thumbRef,
  active = false,
  compact = false,
}: {
  blueprint: Blueprint
  to?: string
  onActivate?: () => void
  thumbRef?: (node: HTMLSpanElement | null) => void
  active?: boolean
  compact?: boolean
}) {
  const visual = blueprintVisual(blueprint)
  const status = recommendedStatus(blueprint)
  return (
    <Link
      to={to ?? `/blueprints/${blueprint.slug}`}
      className={`bp-card ${active ? 'is-active' : ''} ${compact ? 'is-compact' : ''}`}
      style={{ '--tone': visual.tone } as CSSProperties}
      onPointerEnter={onActivate}
      onFocus={onActivate}
    >
      <span className="bp-card-stage" ref={thumbRef}>
        <OrganismThumb genome={visual.genome} motif={visual.motif} fx={visual.fx} size={compact ? 240 : 320} />
        <code>{blueprint.index}</code>
      </span>
      <span className="bp-card-body">
        <span className="bp-card-top">
          <span className="mono-label">{blueprint.category === 'NETWORK' ? 'New network' : blueprint.category === 'APPLICATION' ? 'Application' : 'Expert mode'}</span>
          <BlueprintStatusBadge status={status} />
        </span>
        <strong>{blueprint.name}</strong>
        <span className="bp-card-headline">{blueprint.headline}</span>
        {!compact && (
          <span className="bp-card-ideal">
            {blueprint.idealFor.slice(0, 3).map((item) => (
              <span key={item} className="tag">
                {item}
              </span>
            ))}
          </span>
        )}
        <span className="bp-card-go">
          {to ? 'Choose' : 'Explore'} <ArrowRight size={13} strokeWidth={1.8} />
        </span>
      </span>
    </Link>
  )
}

export function CompatibilityTable({ rows }: { rows: CompatibilityRow[] }) {
  const tone: Record<CompatibilityRow['verdict'], string> = { UNCHANGED: 'var(--green)', COMPATIBLE: 'var(--green)', PARTIAL: 'var(--yellow)', BREAKING: 'var(--red)', UNSOLVED: 'var(--orange)' }
  return (
    <ul className="bp-compat">
      {rows.map((row) => (
        <li key={row.label}>
          <strong>{row.label}</strong>
          <Pill label={row.verdict} tone={tone[row.verdict]} />
          <span>{row.detail}</span>
        </li>
      ))}
    </ul>
  )
}

/** Simple Mode: plain questions, each answer a declared genome patch. Never asks about primitives. */
export function BlueprintQuestions({ compiled, onAnswer }: { compiled: CompiledBlueprint; onAnswer: (answers: Answers) => void }) {
  return (
    <div className="bp-questions">
      {compiled.questions
        .filter((item) => item.visible)
        .map(({ question, option: selected }) => (
          <fieldset key={question.id} className="bp-question">
            <legend>{question.prompt}</legend>
            <div className="bp-options" role="radiogroup" aria-label={question.prompt}>
              {question.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected.id === option.id}
                  disabled={Boolean(option.disabled)}
                  className={`bp-option ${selected.id === option.id ? 'is-active' : ''}`}
                  onClick={() => onAnswer({ ...compiled.answers, [question.id]: option.id })}
                >
                  <span className="bp-option-top">
                    <strong>{option.label}</strong>
                    {(option.disabled ?? option.tag) && <Pill label={option.disabled ?? option.tag ?? ''} tone={option.disabled ? 'var(--faint)' : option.tag === 'EXPERIMENTAL' ? 'var(--red)' : 'var(--yellow)'} />}
                  </span>
                  <span>{option.detail}</span>
                  {selected.id === option.id && <Check size={14} strokeWidth={2} className="bp-option-check" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
    </div>
  )
}

/**
 * The guided path: the genome assembles once, the configured architecture is
 * read back in plain terms, and the user either continues or answers questions.
 */
export function BlueprintConfigurator({
  compiled,
  onAnswer,
  primary,
  note,
}: {
  compiled: CompiledBlueprint
  onAnswer: (answers: Answers) => void
  primary: ReactNode
  note?: ReactNode
}) {
  const reduced = usePrefersReducedMotion()
  const rows = compiled.architecture.length
  const [revealed, setRevealed] = useState(() => (reduced || assemblySeen() ? rows : 0))
  const [customizing, setCustomizing] = useState(false)
  const assembling = revealed < rows

  useEffect(() => {
    if (!assembling) return
    const id = window.setInterval(() => setRevealed((value) => value + 1), 320)
    return () => window.clearInterval(id)
  }, [assembling])

  useEffect(() => {
    if (!assembling) markAssemblySeen()
  }, [assembling])

  return (
    <div className={`bp-config ${assembling ? 'is-assembling' : 'is-loaded'}`}>
      <header className="bp-config-head">
        <p className="mono-label">{assembling ? 'Assembling genome' : 'Blueprint loaded'}</p>
        <h2>{assembling ? 'Configuring the genome…' : 'We configured the genome.'}</h2>
        {assembling && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRevealed(rows)}>
            <SkipForward size={13} strokeWidth={1.8} /> Skip
          </button>
        )}
      </header>
      <ArchitectureReadout rows={compiled.architecture} revealed={revealed} />
      {!assembling && (
        <>
          <WarningList compiled={compiled} />
          {note}
          {customizing && <BlueprintQuestions compiled={compiled} onAnswer={onAnswer} />}
          <div className="bp-config-actions">
            {primary}
            {compiled.questions.some((item) => item.visible) && (
              <button type="button" className="btn btn-secondary" aria-expanded={customizing} onClick={() => setCustomizing((value) => !value)}>
                {customizing ? 'Hide questions' : 'Customize genome'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

interface StageProps {
  blueprint: Blueprint
  /** Hovered, focused or selected: the motif animates fully. */
  active: boolean
  config?: DescendantConfig | null
  interactive?: boolean
  showLabels?: boolean
  className?: string
}

/**
 * A blueprint rendered in one specimen scene. Quantum Chain plays its lineage:
 * the Solana ancestor enters, mutates, and the descendant emerges.
 */
export function BlueprintStage({ blueprint, active, config, interactive = true, showLabels = true, className = '' }: StageProps) {
  const visual = blueprintVisual(blueprint, config)
  const reduced = usePrefersReducedMotion()
  const lineage = blueprint.visualType === 'descendant'
  const [phase, setPhase] = useState<'ancestor' | 'mutate' | 'descendant'>(lineage && !reduced ? 'ancestor' : 'descendant')

  useEffect(() => {
    if (!lineage || reduced) {
      setPhase('descendant')
      return
    }
    setPhase('ancestor')
    const toMutate = window.setTimeout(() => setPhase('mutate'), 1100)
    const toDescendant = window.setTimeout(() => setPhase('descendant'), 2000)
    return () => {
      window.clearTimeout(toMutate)
      window.clearTimeout(toDescendant)
    }
  }, [lineage, reduced, blueprint.slug])

  const genome = phase === 'descendant' ? visual.genome : visual.ancestor
  const mode: SpecimenMode = phase === 'mutate' ? 'mutate' : 'idle'
  const labels = blueprint.visualLabels
  return (
    <div className={`bp-stage ${active ? 'is-active' : ''} ${className}`} style={{ '--tone': visual.tone } as CSSProperties}>
      <SpecimenViewport
        genome={genome}
        fx={phase === 'descendant' ? visual.fx : { exposed: [], alert: 0, lattice: 0, scan: 0 }}
        motif={visual.motif}
        activity={active ? 1 : 0.2}
        mode={mode}
        modeColor="#c8ff4d"
        zoom={1.14}
        interactive={interactive}
        className="bp-viewport"
        label={`${blueprint.name} blueprint, rendered in 3D`}
      />
      {showLabels && (
        <ol className={`bp-labels ${lineage ? 'is-lineage' : ''}`} aria-hidden="true">
          {labels.map((label, index) => (
            <li key={label} style={{ '--i': index } as CSSProperties} className={lineage ? ((index === 0) === (phase !== 'descendant') ? 'is-on' : '') : ''}>
              {index > 0 && <span className="bp-join">{lineage ? '↓' : '+'}</span>}
              {label}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function ArchitectureReadout({ rows, revealed = rows.length, compact = false }: { rows: ArchitectureRow[]; revealed?: number; compact?: boolean }) {
  return (
    <dl className={`bp-architecture ${compact ? 'is-compact' : ''}`}>
      {rows.map((row, index) => (
        <div key={row.key} className={index < revealed ? 'is-shown' : ''} style={{ '--i': index } as CSSProperties}>
          <dt>{row.key}</dt>
          <dd>
            {row.key === 'STATUS' ? <BlueprintStatusBadge status={row.value as BlueprintStatus} /> : <strong>{row.value}</strong>}
            {!compact && <span>{row.detail}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const STEP_TONE: Record<PlanStep['state'], string> = { AVAILABLE: 'var(--green)', DEVNET: 'var(--cyan)', UNAVAILABLE: 'var(--faint)' }

export function PlanSteps({ steps }: { steps: PlanStep[] }) {
  return (
    <ol className="bp-plan">
      {steps.map((step, index) => (
        <li key={step.label} style={{ '--tone': STEP_TONE[step.state] } as CSSProperties}>
          <code>{String(index + 1).padStart(2, '0')}</code>
          <div>
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </div>
          <Pill label={step.state} tone={STEP_TONE[step.state]} />
        </li>
      ))}
    </ol>
  )
}

export function ComponentList({ rows }: { rows: ComponentRow[] }) {
  return (
    <ul className="bp-components">
      {rows.map((row) => (
        <li key={row.id}>
          <code>{row.code}</code>
          <div>
            <strong>{row.name}</strong>
            <span>{row.primitive}</span>
          </div>
          <BlueprintStatusBadge status={row.status} />
        </li>
      ))}
    </ul>
  )
}

export function BurnEstimateView({ burn }: { burn: BurnEstimate }) {
  return (
    <div className="bp-burn">
      <div className="bp-burn-head">
        <span className="mono-label">{burn.operation === 'NONE' ? 'No burn' : `${burn.operation.replace('_', ' ')} burn`}</span>
        <Pill label={burn.basis === 'PROVISIONAL' ? 'ESTIMATED · PROVISIONAL' : burn.basis === 'UNPRICED' ? 'NOT PRICED' : 'FREE'} tone={burn.basis === 'PROVISIONAL' ? 'var(--yellow)' : 'var(--muted)'} />
      </div>
      <p className="bp-burn-total">{burn.total === null ? '—' : burn.total === 0 ? '0 QFORK' : `${formatNumber(burn.total)} QFORK`}</p>
      {burn.lines.length > 0 && (
        <ul>
          {burn.lines.map((line) => (
            <li key={line.label}>
              <span>{line.label}</span>
              <code>{formatNumber(line.amount)}</code>
            </li>
          ))}
        </ul>
      )}
      <p className="bp-note">{burn.note}</p>
    </div>
  )
}

export function IdealFor({ items }: { items: string[] }) {
  return (
    <p className="bp-ideal">
      <span className="mono-label">Ideal for</span>
      {items.map((item) => (
        <span key={item} className="tag">
          {item}
        </span>
      ))}
    </p>
  )
}

export function WarningList({ compiled }: { compiled: CompiledBlueprint }) {
  if (!compiled.warnings.length) return null
  return (
    <ul className="bp-warnings">
      {compiled.warnings.map((warning) => (
        <li key={warning.message} className={`is-${warning.level}`}>
          {warning.message}
        </li>
      ))}
    </ul>
  )
}
