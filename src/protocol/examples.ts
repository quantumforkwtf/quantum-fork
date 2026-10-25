import { type DescendantConfig, defaultConfig, normalizeConfig } from './descendant.js'
import type { ProfileId } from './profiles.js'

export interface ExampleSpec {
  id: string
  code: string
  parentId: string
  generation: number
  config: DescendantConfig
}

function example(id: string, code: string, profile: ProfileId, name: string, symbol: string, parentId: string, generation: number, patch: Partial<DescendantConfig> = {}): ExampleSpec {
  return { id, code, parentId, generation, config: normalizeConfig({ ...defaultConfig(profile), ...patch, network: { name, symbol, networkId: id } }) }
}

/** Illustrative descendants so the explorer is never empty. Never counted as real activity. */
export const EXAMPLE_SPECS: ExampleSpec[] = [
  example('example-hybrid', 'EX-01', 'hybrid', 'EXAMPLE HYBRID', 'XHYB', 'base', 1),
  example('example-forward', 'EX-02', 'pq-forward', 'EXAMPLE FORWARD', 'XFWD', 'base', 1, { validators: { count: 48, hardware: 'high' } }),
  example('example-research', 'EX-03', 'research', 'EXAMPLE LATTICE', 'XLAT', 'example-forward', 2, { privacy: 'shielded' }),
]
