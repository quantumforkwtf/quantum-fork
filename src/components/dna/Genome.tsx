import { useMemo } from 'react'
import { arcPath, dnaGlyph } from '../../lab/dnaGlyph'
import type { ChainDna } from '../../protocol/chainDna'

const SIZE = 240
const C = SIZE / 2

/** Deterministic Chain Genome. Rings are categories; colour is support on the chosen target. */
export function Genome({ dna, size = SIZE, title }: { dna: ChainDna; size?: number; title?: string }) {
  const glyph = useMemo(() => dnaGlyph(dna), [dna])
  const outer = glyph.rings[0].radius + 10
  return (
    <svg className="genome" width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={title ?? `Chain genome ${glyph.hash.slice(0, 10)}`}>
      <title>{title ?? `Chain genome · technical hash ${glyph.hash.slice(0, 18)}…`}</title>
      {glyph.ticks.map((tick) => {
        const rad = ((tick.angle - 90) * Math.PI) / 180
        return (
          <line
            key={tick.angle}
            x1={C + outer * Math.cos(rad)}
            y1={C + outer * Math.sin(rad)}
            x2={C + (outer + tick.length) * Math.cos(rad)}
            y2={C + (outer + tick.length) * Math.sin(rad)}
            className="genome-tick"
          />
        )
      })}
      {glyph.rings.map((ring) => (
        <g key={ring.category}>
          <circle cx={C} cy={C} r={ring.radius} className="genome-track" />
          {ring.arcs.map((arc) => (
            <path key={arc.label} d={arcPath(C, C, ring.radius, arc.start, arc.end)} stroke={arc.color} className={`genome-arc is-${arc.support}`}>
              <title>{arc.label}</title>
            </path>
          ))}
        </g>
      ))}
      <TargetCore target={glyph.target} />
      {glyph.cells.map((cell) => (
        <rect key={`${cell.x}-${cell.y}`} x={C - 10 + cell.x * 4} y={C - 10 + cell.y * 4} width={3} height={3} className="genome-cell" />
      ))}
    </svg>
  )
}

function TargetCore({ target }: { target: ChainDna['target'] }) {
  if (target === 'base') return <circle cx={C} cy={C} r={17} className="genome-core" />
  if (target === 'local-devnet') return <rect x={C - 15} y={C - 15} width={30} height={30} className="genome-core" />
  const points = Array.from({ length: 6 }, (_, index) => {
    const rad = ((index * 60 - 90) * Math.PI) / 180
    return `${(C + 18 * Math.cos(rad)).toFixed(2)},${(C + 18 * Math.sin(rad)).toFixed(2)}`
  }).join(' ')
  return <polygon points={points} className="genome-core" />
}
