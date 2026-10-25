import { hashString } from '../lib/random.js'
import type { DescendantConfig } from './descendant.js'

/** Structures a registered descendant grows around its organism, from real records only. */
export type LayerKind = 'orbit' | 'membrane' | 'bud'

export interface LayerSpec {
  /** Stable identity: the same key keeps the same structure across updates. */
  key: string
  kind: LayerKind
  seed: number
  index: number
  count?: number
  /** 0–1: how strongly it animates. */
  activity?: number
}

/** One orbit per verified token, a membrane for a shielded design, one bud per registered fork. Same records, same organism. */
export function networkLayers(id: string, config: DescendantConfig, tokens: readonly { mint: string; symbol: string }[], forks: number): LayerSpec[] {
  const layers: LayerSpec[] = []
  tokens.slice(0, 6).forEach((token, index) => layers.push({ key: `orbit:${token.mint}`, kind: 'orbit', seed: hashString(`${id}:${token.symbol}`), index }))
  if (config.privacy === 'shielded') layers.push({ key: 'membrane', kind: 'membrane', seed: 0, index: 0, activity: 0.6 })
  for (let index = 0; index < Math.min(3, forks); index += 1) layers.push({ key: `bud:${index}`, kind: 'bud', seed: hashString(`${id}:bud:${index}`), index })
  return layers
}

/** How strongly the post-quantum lattice shell shows, from the profile. */
export function latticeFor(config: DescendantConfig) {
  if (!config.modules.length) return 0
  return { hybrid: 0.45, 'pq-forward': 0.7, research: 0.95, custom: 0.5 }[config.profile]
}
