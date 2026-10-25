import { hexToBytes } from 'viem'
import { CATEGORIES, type Category, type ChainDna, chosenOptions, type Support, type Target, technicalHash } from '../protocol/chainDna.js'

/** Support level → palette. Colour always means the same thing: what the target can do with that choice. */
export const SUPPORT_COLOR: Record<Support, string> = {
  native: 'var(--green)',
  contracts: 'var(--cyan)',
  infrastructure: 'var(--yellow)',
  research: 'var(--purple)',
  unsupported: 'var(--red)',
}

export interface GlyphArc {
  start: number
  end: number
  color: string
  label: string
  support: Support
}

export interface Glyph {
  hash: `0x${string}`
  target: Target
  rings: { category: Category; radius: number; arcs: GlyphArc[] }[]
  ticks: { angle: number; length: number }[]
  cells: { x: number; y: number }[]
}

const RING_START = 34
const RING_STEP = 13

/**
 * The Chain Genome: rings are categories (network outermost), arcs are chosen options coloured by
 * support on the target, ticks encode block time, and the core matrix is the technical hash.
 * Pure: the same technical configuration always yields the same glyph.
 */
export function dnaGlyph(dna: ChainDna): Glyph {
  const hash = technicalHash(dna)
  const bytes = hexToBytes(hash)
  const chosen = chosenOptions(dna)
  const rings = CATEGORIES.map((category, index) => {
    const options = chosen.filter((item) => item.field.category === category)
    const span = 360 / Math.max(1, options.length)
    const offset = (bytes[index] / 256) * 360
    const gap = Math.min(10, span * 0.18)
    return {
      category,
      radius: RING_START + (CATEGORIES.length - 1 - index) * RING_STEP,
      arcs: options.map((item, slot) => ({
        start: offset + slot * span + gap / 2,
        end: offset + (slot + 1) * span - gap / 2,
        color: SUPPORT_COLOR[item.support],
        label: `${item.field.label}: ${item.option.label}`,
        support: item.support,
      })),
    }
  })
  const seconds = dna.network.blockTimeMs / 1000
  const count = seconds === 0 ? 72 : Math.max(6, Math.round(72 / seconds))
  const ticks = Array.from({ length: count }, (_, index) => ({ angle: (index / count) * 360, length: 3 + (bytes[(index % 26) + 6] % 4) }))
  const cells: { x: number; y: number }[] = []
  for (let bit = 0; bit < 25; bit += 1) if ((bytes[24 + (bit >> 3)] >> (bit & 7)) & 1) cells.push({ x: bit % 5, y: Math.floor(bit / 5) })
  return { hash, target: dna.target, rings, ticks, cells }
}

export function arcPath(cx: number, cy: number, radius: number, startDeg: number, endDeg: number) {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)].map((value) => value.toFixed(2))
  }
  const [x1, y1] = point(startDeg)
  const [x2, y2] = point(endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`
}
