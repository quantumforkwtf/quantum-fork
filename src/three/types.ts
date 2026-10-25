import type { ChainGenome } from '../lab/genome'
import type { OrganPart } from '../lab/morphology'
import type { ReactorPhase } from '../lab/protocol'
import type { VisualType } from '../protocol/blueprints'
import type { LayerSpec } from '../protocol/networkLayers'

export type { LayerKind, LayerSpec } from '../protocol/networkLayers'

export type SpecimenMode = 'idle' | 'mutate'

/** A blueprint's structure around the organism (vault shells, payment paths…). */
export type MotifKind = VisualType

/** Analysis overlays shared by every organism view. */
export interface OrganismFx {
  /** Organs whose cryptography is classically exposed. */
  exposed: OrganPart[]
  /** 0–1: how strongly exposed organs glow red. */
  alert: number
  /** 0–1: post-quantum lattice shell around the body. */
  lattice: number
  /** Changing this number runs one scan-beam sweep; exposure lights up as the beam passes. */
  scan: number
}

export const NO_FX: OrganismFx = { exposed: [], alert: 0, lattice: 0, scan: 0 }

export interface SpecimenOptions {
  genome: ChainGenome
  highlight?: OrganPart | null
  interactive?: boolean
  /** Camera distance multiplier; below 1 moves closer. */
  zoom?: number
  autoRotate?: boolean
  fx?: OrganismFx
  motif?: MotifKind | null
  /** 0–1: how strongly the motif animates. */
  activity?: number
  layers?: LayerSpec[]
}

export interface SpecimenController {
  setGenome(genome: ChainGenome, options?: { flash?: boolean }): void
  setHighlight(part: OrganPart | null): void
  setMode(mode: SpecimenMode, color?: number): void
  setFx(fx: OrganismFx): void
  /** Crossfades to another motif, or removes it. */
  setMotif(kind: MotifKind | null): void
  setActivity(level: number): void
  /** Grows new layers in and dissolves removed ones. A new layer flashes the body once. */
  setLayers(layers: LayerSpec[]): void
  dispose(): void
}

export interface ReactorOptions {
  genome: ChainGenome
  phase?: ReactorPhase
  framing?: 'right' | 'center'
  compact?: boolean
  showResult?: boolean
  fx?: OrganismFx
  motif?: MotifKind | null
  /** 0–1: how strongly the motif animates. */
  activity?: number
}

export interface ReactorController {
  setPhase(phase: ReactorPhase): void
  /** `soft` folds the organism away and regrows it as the new genome instead of swapping it in place. */
  setGenome(genome: ChainGenome, options?: { soft?: boolean }): void
  /** Crossfades to another blueprint motif around the organism, or removes it. */
  setMotif(kind: MotifKind | null): void
  setFraming(framing: 'right' | 'center'): void
  setFx(fx: OrganismFx): void
  /** 0–1: dims the chamber for the genesis moment. */
  setDim(amount: number): void
  dispose(): void
}
