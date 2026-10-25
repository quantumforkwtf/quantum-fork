import type { ChainGenome } from './genome'
import { exposedParts } from '../protocol/ancestors'
import { compileBlueprint } from '../protocol/blueprintCompiler'
import type { Blueprint, BlueprintStatus, ToneId } from '../protocol/blueprints'
import { ancestorGenome, type DescendantConfig, toChainGenome } from '../protocol/descendant'
import { NO_FX, type MotifKind, type OrganismFx } from '../three/types'

export const TONE: Record<ToneId, string> = {
  lime: 'var(--lime)',
  cyan: 'var(--cyan)',
  yellow: 'var(--yellow)',
  purple: 'var(--purple)',
  green: 'var(--green)',
  steel: 'var(--text)',
  orange: 'var(--orange)',
  red: 'var(--red)',
}

export const STATUS_TONE: Record<BlueprintStatus, string> = {
  AVAILABLE: 'var(--green)',
  TESTNET: 'var(--cyan)',
  EXPERIMENTAL: 'var(--purple)',
  RESEARCH: 'var(--yellow)',
  'COMING SOON': 'var(--muted)',
}

export interface BlueprintVisual {
  genome: ChainGenome
  /** What the organism starts as, for blueprints that show a transformation. */
  ancestor: ChainGenome
  fx: OrganismFx
  motif: MotifKind
  tone: string
}

const ANCESTOR = ancestorGenome()
const EXPOSED = exposedParts()
const cache = new Map<string, BlueprintVisual>()

/** How a blueprint is drawn. Network blueprints show the descendant they compile to. */
export function blueprintVisual(blueprint: Blueprint, config?: DescendantConfig | null): BlueprintVisual {
  const cached = config === undefined ? cache.get(blueprint.slug) : undefined
  if (cached) return cached
  const resolved = config === undefined ? compileBlueprint(blueprint).config : config
  let visual: BlueprintVisual
  if (resolved) {
    visual = { genome: toChainGenome(resolved), ancestor: ancestorGenome(resolved.ancestor), fx: { ...NO_FX, lattice: blueprint.visualType === 'descendant' ? 0.6 : 0.3 }, motif: blueprint.visualType, tone: TONE[blueprint.tone] }
  } else if (blueprint.visualType === 'chain-scan') {
    visual = { genome: ANCESTOR, ancestor: ANCESTOR, fx: { exposed: EXPOSED, alert: 0.85, lattice: 0, scan: 0 }, motif: 'chain-scan', tone: TONE[blueprint.tone] }
  } else if (blueprint.visualType === 'app-scan') {
    visual = { genome: ANCESTOR, ancestor: ANCESTOR, fx: { exposed: EXPOSED.slice(0, 3), alert: 0.5, lattice: 0, scan: 0 }, motif: 'app-scan', tone: TONE[blueprint.tone] }
  } else {
    visual = { genome: ANCESTOR, ancestor: ANCESTOR, fx: NO_FX, motif: blueprint.visualType, tone: TONE[blueprint.tone] }
  }
  if (config === undefined) cache.set(blueprint.slug, visual)
  return visual
}
