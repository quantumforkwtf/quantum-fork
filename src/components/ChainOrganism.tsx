import { type CSSProperties, useEffect, useId, useMemo, useRef } from 'react'
import { type ChainGenome, fingerprint, PALETTE } from '../lab/genome'
import { buildMorphology, type Morphology, type OrganPart, polar } from '../lab/morphology'
import { useInView, usePrefersReducedMotion } from '../lib/hooks'

interface ChainOrganismProps {
  genome: ChainGenome
  highlight?: OrganPart | null
  animated?: boolean
  className?: string
  label?: string
}

const C = 200

/** The 2D fallback is drawn as a dark specimen: near-black tissue, steel line work, neon organs. */
const P = { ...PALETTE, ink: '#07090A', charcoal: '#111416', graphite: '#2E3438', paper: '#1A1E21', bone: '#1F2427' }

export default function ChainOrganism({
  genome,
  highlight = null,
  animated = true,
  className = '',
  label,
}: ChainOrganismProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const fp = fingerprint(genome)
  const m = useMemo(() => buildMorphology(genome), [genome])
  const wrapRef = useRef<HTMLDivElement>(null)
  const pingRef = useRef<HTMLSpanElement>(null)
  const inView = useInView(wrapRef)
  const reduced = usePrefersReducedMotion()
  const live = animated && inView && !reduced
  const previous = useRef(fp)

  useEffect(() => {
    if (previous.current === fp) return
    previous.current = fp
    if (reduced) return
    wrapRef.current?.animate(
      [
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(0.9) rotate(-3deg)', filter: 'brightness(1.5) saturate(1.4)', offset: 0.25 },
        { transform: 'scale(1.06) rotate(1.5deg)', offset: 0.6 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 620, easing: 'cubic-bezier(.2,.8,.2,1)' },
    )
    pingRef.current?.animate(
      [
        { transform: 'scale(0.4)', opacity: 0.9 },
        { transform: 'scale(1.25)', opacity: 0 },
      ],
      { duration: 700, easing: 'cubic-bezier(.16,1,.3,1)' },
    )
  }, [fp, reduced])

  return (
    <div
      ref={wrapRef}
      className={`organism ${live ? 'is-live' : ''} ${className}`}
      data-highlight={highlight ?? undefined}
    >
      <span ref={pingRef} className="organism-ping" aria-hidden="true" />
      <svg
        viewBox="0 0 400 400"
        role="img"
        aria-label={label ?? `${genome.identity.name} specimen, generation ${genome.lineage.generation}`}
      >
        <Defs uid={uid} m={m} />
        <circle cx={C} cy={C} r={198} fill={`url(#${uid}-halo)`} className="org-halo" />

        {m.speedLines.length > 0 && (
          <g className="p p-execution org-speed">
            {m.speedLines.map((d) => (
              <path key={d} d={d} fill="none" stroke={P.steel} strokeOpacity={0.5} strokeWidth={3} strokeLinecap="round" strokeDasharray="18 10" />
            ))}
          </g>
        )}

        <g
          className="p p-consensus org-satellites"
          style={{ animationDuration: `${m.satellites.duration}s` } as CSSProperties}
        >
          <circle cx={C} cy={C} r={m.satellites.radius} fill="none" stroke={P.steel} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="1 7" strokeLinecap="round" />
          {m.satellites.points.map((point, index) => (
            <circle key={index} cx={point.x} cy={point.y} r={5.5} fill={P.lime} stroke={P.ink} strokeWidth={2.5} />
          ))}
        </g>

        <Tentacles m={m} />
        <RecoveryBack m={m} />

        <path d={m.membrane} transform="translate(6 7)" fill={P.ink} />
        <g className="p p-hash org-membrane">
          <path d={m.membrane} fill={P.charcoal} stroke={m.tint} strokeWidth={4} strokeLinejoin="round" />
          <path d={m.membrane} fill={`url(#${uid}-pattern)`} opacity={0.24} />
          {m.bands.map((scale) => (
            <path
              key={scale}
              d={m.membrane}
              transform={`translate(${C} ${C}) scale(${scale}) translate(${-C} ${-C})`}
              fill="none"
              stroke={P.ink}
              strokeWidth={1.6 / scale}
              strokeDasharray="3 6"
              opacity={0.4}
            />
          ))}
          {m.cilia.map((cilium, index) => (
            <line key={index} x1={cilium.from.x} y1={cilium.from.y} x2={cilium.to.x} y2={cilium.to.y} stroke={P.ink} strokeWidth={3.5} strokeLinecap="round" />
          ))}
        </g>

        <Economics m={m} />
        <Organelles m={m} />

        <g className="p org-stitches">
          {m.stitches.map((stitch, index) => (
            <g key={index} transform={`translate(${stitch.x} ${stitch.y}) rotate(${stitch.angle})`}>
              <path d="M-5 -5L5 5M5 -5L-5 5" stroke={P.ink} strokeWidth={6} strokeLinecap="round" />
              <path d="M-5 -5L5 5M5 -5L-5 5" stroke={P.orange} strokeWidth={3} strokeLinecap="round" />
            </g>
          ))}
        </g>

        <Shield m={m} />
        <Proof m={m} />
        <Nucleus m={m} uid={uid} />
        <Core m={m} />
        <Cloud m={m} uid={uid} />
        <Orbitals m={m} live={live} />
        <RecoveryFront m={m} />
      </svg>
    </div>
  )
}

function Defs({ uid, m }: { uid: string; m: Morphology }) {
  return (
    <defs>
      <radialGradient id={`${uid}-halo`}>
        <stop offset="0%" stopColor={m.haloColor} stopOpacity={0.55} />
        <stop offset="55%" stopColor={m.haloColor} stopOpacity={0.16} />
        <stop offset="100%" stopColor={m.haloColor} stopOpacity={0} />
      </radialGradient>
      <radialGradient id={`${uid}-nucleus`} cx="36%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#C9F6FF" />
        <stop offset="45%" stopColor={P.cyan} />
        <stop offset="100%" stopColor="#0B6E86" />
      </radialGradient>
      <pattern id={`${uid}-tone`} width="5" height="5" patternUnits="userSpaceOnUse">
        <circle cx="2.5" cy="2.5" r="1.05" fill={P.ink} />
      </pattern>
      {m.pattern === 'dots' && (
        <pattern id={`${uid}-pattern`} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="1.5" fill={P.ink} />
        </pattern>
      )}
      {m.pattern === 'hex' && (
        <pattern id={`${uid}-pattern`} width="14" height="24" patternUnits="userSpaceOnUse">
          <path d="M7 0L14 4V12L7 16L0 12V4ZM7 16V24" fill="none" stroke={P.ink} strokeWidth="1.1" />
        </pattern>
      )}
      {m.pattern === 'waves' && (
        <pattern id={`${uid}-pattern`} width="16" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 4Q4 0 8 4T16 4" fill="none" stroke={P.ink} strokeWidth="1.2" />
        </pattern>
      )}
    </defs>
  )
}

function Tentacles({ m }: { m: Morphology }) {
  return (
    <g className="p p-execution org-tentacles">
      {m.tentacles.map((tentacle, index) => (
        <g
          key={index}
          className="org-tentacle"
          style={
            {
              transformOrigin: `${tentacle.base.x}px ${tentacle.base.y}px`,
              animationDelay: `${tentacle.delay}s`,
              animationDuration: `${tentacle.duration}s`,
            } as CSSProperties
          }
        >
          <path d={tentacle.d} fill="none" stroke={P.ink} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" />
          <path d={tentacle.d} fill="none" stroke={P.bone} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
          {tentacle.joints.map((joint, jointIndex) => (
            <circle key={jointIndex} cx={joint.x} cy={joint.y} r={5.5} fill={P.graphite} stroke={P.ink} strokeWidth={2.5} />
          ))}
          {tentacle.curl && (
            <>
              <path d={tentacle.curl} fill="none" stroke={P.ink} strokeWidth={9} strokeLinecap="round" />
              <path d={tentacle.curl} fill="none" stroke={P.bone} strokeWidth={4} strokeLinecap="round" />
            </>
          )}
          <circle cx={tentacle.tip.x} cy={tentacle.tip.y} r={7} fill={P.lime} stroke={P.ink} strokeWidth={3} />
        </g>
      ))}
    </g>
  )
}

function RecoveryBack({ m }: { m: Morphology }) {
  const { skull, tether } = m.recovery
  if (!skull || !tether) return null
  return (
    <g className="p p-recovery">
      <line x1={tether.from.x} y1={tether.from.y} x2={skull.x} y2={skull.y} stroke={P.ink} strokeWidth={3} strokeDasharray="2 6" strokeLinecap="round" />
    </g>
  )
}

function Economics({ m }: { m: Morphology }) {
  return (
    <g className="p p-economics">
      {m.treasury && (
        <g>
          <circle cx={m.treasury.x} cy={m.treasury.y} r={m.treasury.r} fill={P.bone} stroke={P.ink} strokeWidth={3} />
          <circle cx={m.treasury.x} cy={m.treasury.y} r={m.treasury.r * 0.5} fill="none" stroke={P.green} strokeWidth={2.5} />
        </g>
      )}
      {m.vents.map((vent, index) => {
        const base = polar(vent.angle, m.radius + 1)
        const deg = (vent.angle * 180) / Math.PI
        return (
          <g key={index} transform={`translate(${base.x} ${base.y}) rotate(${deg + 90})`}>
            <g className="org-vent" style={{ animationDelay: `${index * -0.3}s` }}>
              <path d="M-6 0Q-7 -10 0 -19Q7 -10 6 0Z" fill={P.orange} stroke={P.ink} strokeWidth={3} strokeLinejoin="round" />
              <path d="M-2 -3Q-2 -8 0 -11Q2 -8 2 -3Z" fill={P.yellow} />
            </g>
          </g>
        )
      })}
    </g>
  )
}

function Organelles({ m }: { m: Morphology }) {
  return (
    <g className="p p-modules">
      {m.organelles.map((organelle) => {
        const deg = (organelle.angle * 180) / Math.PI
        const base = polar(organelle.angle, m.radius - 4)
        return (
          <g key={organelle.kind} transform={`translate(${base.x} ${base.y}) rotate(${deg})`}>
            {organelle.kind === 'bridge' && (
              <>
                <path d="M0 -9L17 -12L37 0L17 12L0 9Z" fill={P.cyan} stroke={P.ink} strokeWidth={4} strokeLinejoin="round" />
                <path d="M2 0L37 0M17 -12L22 0L17 12" fill="none" stroke={P.ink} strokeWidth={1.5} opacity={0.6} />
              </>
            )}
            {organelle.kind === 'oracle' && (
              <>
                <line x1={0} y1={0} x2={26} y2={0} stroke={P.ink} strokeWidth={7} strokeLinecap="round" />
                <line x1={0} y1={0} x2={26} y2={0} stroke={P.bone} strokeWidth={2.5} strokeLinecap="round" />
                <circle cx={33} cy={0} r={10} fill={P.bone} stroke={P.ink} strokeWidth={4} />
                <circle cx={36} cy={0} r={4} fill={P.ink} />
              </>
            )}
            {organelle.kind === 'governance' && (
              <>
                {[-11, 0, 11].map((offset, index) => (
                  <path
                    key={offset}
                    d={`M0 ${offset - 6}L${index === 1 ? 26 : 18} ${offset}L0 ${offset + 6}Z`}
                    fill={P.bone}
                    stroke={P.ink}
                    strokeWidth={3.5}
                    strokeLinejoin="round"
                  />
                ))}
                <circle cx={26} cy={0} r={3.5} fill={P.green} stroke={P.ink} strokeWidth={2} />
              </>
            )}
            {organelle.kind === 'names' && (
              <>
                <path d="M4 -12L18 -12L25 0L18 12L4 12L-3 0Z" fill={P.bone} stroke={P.ink} strokeWidth={4} strokeLinejoin="round" />
                <path d="M6 -3H17M6 3H14" stroke={P.ink} strokeWidth={2} strokeLinecap="round" />
              </>
            )}
            {organelle.kind === 'dex' && (
              <>
                <line x1={10} y1={-10} x2={10} y2={10} stroke={P.ink} strokeWidth={4} />
                <circle cx={12} cy={-10} r={9} fill={P.pink} stroke={P.ink} strokeWidth={4} />
                <circle cx={12} cy={10} r={9} fill={P.pink} stroke={P.ink} strokeWidth={4} />
              </>
            )}
          </g>
        )
      })}
    </g>
  )
}

function Shield({ m }: { m: Morphology }) {
  if (!m.shield) return null
  const { kind, r, particles, hexes } = m.shield
  return (
    <g className="p p-pq org-shield">
      {kind === 'ring' ? (
        <>
          <circle cx={C} cy={C} r={r} fill="none" stroke={P.ink} strokeWidth={8} strokeDasharray="16 11" />
          <circle cx={C} cy={C} r={r} fill="none" stroke={P.yellow} strokeWidth={4} strokeDasharray="16 11" />
        </>
      ) : (
        hexes.map((points, index) => (
          <g key={points} className={index === 1 ? 'org-shield-counter' : undefined}>
            <polygon points={points} fill="none" stroke={P.ink} strokeWidth={7} strokeLinejoin="round" />
            <polygon points={points} fill="none" stroke={P.yellow} strokeWidth={3} strokeLinejoin="round" />
          </g>
        ))
      )}
      {particles.map((particle, index) => (
        <rect
          key={index}
          x={particle.x - 5}
          y={particle.y - 5}
          width={10}
          height={10}
          transform={`rotate(45 ${particle.x} ${particle.y})`}
          fill={P.yellow}
          stroke={P.ink}
          strokeWidth={2.5}
        />
      ))}
    </g>
  )
}

function Proof({ m }: { m: Morphology }) {
  if (!m.proof) return null
  const r = m.nucleus.r + 13
  const ticks = Array.from({ length: m.proof.ticks }, (_, index) => {
    const angle = (index / m.proof!.ticks) * Math.PI * 2
    return { from: polar(angle, r + 1), to: polar(angle, r + 7) }
  })
  return (
    <g className="p p-proof org-proof">
      <circle cx={C} cy={C} r={r} fill="none" stroke={P.ink} strokeWidth={2.5} />
      {m.proof.double && <circle cx={C} cy={C} r={r + 12} fill="none" stroke={P.ink} strokeWidth={1.5} strokeDasharray="4 4" />}
      {ticks.map((tick, index) => (
        <line key={index} x1={tick.from.x} y1={tick.from.y} x2={tick.to.x} y2={tick.to.y} stroke={P.cyan} strokeWidth={2.5} strokeLinecap="round" />
      ))}
    </g>
  )
}

function Nucleus({ m, uid }: { m: Morphology; uid: string }) {
  const { shape, r, path, lobes, tier } = m.nucleus
  const fill = `url(#${uid}-nucleus)`
  return (
    <g className="p p-signature org-nucleus">
      {shape === 'trilobe' ? (
        <>
          {lobes.map((lobe, index) => (
            <circle key={`o${index}`} cx={lobe.x} cy={lobe.y} r={r * 0.68 + 2.5} fill={P.ink} />
          ))}
          {lobes.map((lobe, index) => (
            <circle key={`f${index}`} cx={lobe.x} cy={lobe.y} r={r * 0.68 - 2.5} fill={fill} />
          ))}
        </>
      ) : (
        <path d={path} fill={fill} stroke={P.ink} strokeWidth={5} strokeLinejoin="round" />
      )}
      {shape === 'eye' && <ellipse cx={C} cy={C} rx={r * 0.2} ry={r * 0.66} fill={P.ink} opacity={0.9} />}
      {tier >= 1 && (
        <circle cx={C} cy={C} r={r * 0.66} fill="none" stroke={P.yellow} strokeWidth={3.5} strokeDasharray={tier === 2 ? '5 4' : undefined} />
      )}
      {tier === 2 &&
        [0, 1, 2, 3, 4, 5].map((index) => {
          const point = polar((index * Math.PI) / 3 + 0.25, r * 0.95)
          return <line key={index} x1={C} y1={C} x2={point.x} y2={point.y} stroke={P.ink} strokeWidth={1.6} opacity={0.55} />
        })}
      <path
        d={`M${C - r * 0.66} ${C - r * 0.08}A${r * 0.68} ${r * 0.68} 0 0 1 ${C - r * 0.06} ${C - r * 0.66}A${r * 0.52} ${r * 0.52} 0 0 0 ${C - r * 0.66} ${C - r * 0.08}Z`}
        fill={P.bone}
        opacity={0.8}
      />
    </g>
  )
}

function Core({ m }: { m: Morphology }) {
  return (
    <g className="p p-keys org-core">
      {m.core === 'single' && (
        <>
          <circle cx={C} cy={C} r={7} fill={P.ink} />
          <circle cx={C} cy={C} r={2.6} fill={P.lime} />
        </>
      )}
      {m.core === 'dual' && (
        <>
          <line x1={C - 7} y1={C} x2={C + 7} y2={C} stroke={P.ink} strokeWidth={3.5} />
          <circle cx={C - 7} cy={C} r={5.5} fill={P.ink} />
          <circle cx={C + 7} cy={C} r={5.5} fill={P.ink} />
          <circle cx={C - 7} cy={C} r={2} fill={P.lime} />
          <circle cx={C + 7} cy={C} r={2} fill={P.yellow} />
        </>
      )}
      {m.core === 'triad' &&
        [0, 1, 2].map((index) => {
          const point = polar(-Math.PI / 2 + (index * Math.PI * 2) / 3, 8)
          return (
            <g key={index}>
              <circle cx={point.x} cy={point.y} r={4.8} fill={P.ink} />
              <circle cx={point.x} cy={point.y} r={1.8} fill={index === 0 ? P.red : P.yellow} />
            </g>
          )
        })}
    </g>
  )
}

function Cloud({ m, uid }: { m: Morphology; uid: string }) {
  if (!m.cloud) return null
  return (
    <g className="p p-privacy org-cloud">
      {m.cloud.blobs.map((blob, index) => (
        <circle key={`o${index}`} cx={blob.x} cy={blob.y} r={blob.r + 4} fill={P.ink} />
      ))}
      {m.cloud.blobs.map((blob, index) => (
        <circle key={`f${index}`} cx={blob.x} cy={blob.y} r={blob.r - 0.5} fill={P.purple} />
      ))}
      {m.cloud.blobs.map((blob, index) => (
        <circle key={`t${index}`} cx={blob.x} cy={blob.y} r={blob.r - 0.5} fill={`url(#${uid}-tone)`} opacity={0.22} />
      ))}
      {m.cloud.blobs.slice(0, 4).map((blob, index) => (
        <path
          key={`h${index}`}
          d={`M${blob.x - blob.r * 0.55} ${blob.y - blob.r * 0.1}A${blob.r * 0.6} ${blob.r * 0.6} 0 0 1 ${blob.x - blob.r * 0.05} ${blob.y - blob.r * 0.6}`}
          fill="none"
          stroke="#B9A4FF"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ))}
      {m.cloud.full && (
        <g className="org-glint">
          <rect x={C - 14} y={C - 2.5} width={10} height={5} rx={2.5} fill={P.cyan} />
          <rect x={C + 4} y={C - 2.5} width={10} height={5} rx={2.5} fill={P.cyan} />
        </g>
      )}
    </g>
  )
}

function Orbitals({ m, live }: { m: Morphology; live: boolean }) {
  return (
    <g className="p p-pq org-orbitals">
      {m.orbitals.map((orbital, index) => (
        <g key={index}>
          <g transform={`rotate(${orbital.tilt} ${C} ${C})`}>
            <path d={orbital.d} fill="none" stroke={P.ink} strokeWidth={orbital.exotic ? 2 : 2.4} strokeOpacity={0.75} strokeDasharray={orbital.exotic ? '6 5' : undefined} />
          </g>
          {orbital.electrons.map((electron, electronIndex) =>
            live ? (
              <g key={electronIndex} transform={`rotate(${orbital.tilt} ${C} ${C})`}>
                <circle r={6} fill={electron.color} stroke={P.ink} strokeWidth={2.5}>
                  <animateMotion
                    dur={`${orbital.duration}s`}
                    repeatCount="indefinite"
                    path={orbital.d}
                    begin={`${-electron.begin * orbital.duration}s`}
                  />
                </circle>
              </g>
            ) : (
              <circle key={electronIndex} cx={electron.x} cy={electron.y} r={6} fill={electron.color} stroke={P.ink} strokeWidth={2.5} />
            ),
          )}
        </g>
      ))}
    </g>
  )
}

function RecoveryFront({ m }: { m: Morphology }) {
  const { kind, pods, beads, beadArc, skull } = m.recovery
  if (kind === 'none') return null
  return (
    <g className="p p-recovery">
      {kind === 'multisig' && (
        <>
          <line x1={pods[0].x} y1={pods[0].y} x2={pods[1].x} y2={pods[1].y} stroke={P.ink} strokeWidth={3.5} />
          {pods.map((pod, index) => (
            <g key={index} transform={`translate(${pod.x} ${pod.y}) rotate(${(m.recovery.angle * 180) / Math.PI})`}>
              <rect x={-7} y={-9} width={14} height={18} rx={4} fill={P.bone} stroke={P.ink} strokeWidth={3} />
              <circle cx={0} cy={-2} r={2.6} fill={P.ink} />
              <line x1={0} y1={0} x2={0} y2={5} stroke={P.ink} strokeWidth={2.5} />
            </g>
          ))}
        </>
      )}
      {kind === 'threshold' && (
        <>
          <path d={beadArc} fill="none" stroke={P.ink} strokeWidth={2.5} />
          {beads.map((bead, index) => (
            <circle key={index} cx={bead.x} cy={bead.y} r={5.5} fill={bead.lit ? P.green : P.bone} stroke={P.ink} strokeWidth={2.5} />
          ))}
        </>
      )}
      {kind === 'deadman' && skull && (
        <g className="org-skull" style={{ transformOrigin: `${skull.x}px ${skull.y}px` }}>
          <circle cx={skull.x + 4} cy={skull.y + 5} r={skull.r} fill={P.ink} />
          <circle cx={skull.x} cy={skull.y} r={skull.r} fill={P.graphite} stroke={P.ink} strokeWidth={4} />
          <ellipse cx={skull.x - 7} cy={skull.y - 3} rx={5} ry={6} fill={P.ink} />
          <ellipse cx={skull.x + 7} cy={skull.y - 3} rx={5} ry={6} fill={P.ink} />
          <circle cx={skull.x - 6} cy={skull.y - 2} r={1.6} fill={P.red} className="org-skull-eye" />
          <circle cx={skull.x + 8} cy={skull.y - 2} r={1.6} fill={P.red} className="org-skull-eye" />
          <path d={`M${skull.x - 6} ${skull.y + 9}V${skull.y + 14}M${skull.x} ${skull.y + 9}V${skull.y + 15}M${skull.x + 6} ${skull.y + 9}V${skull.y + 14}`} stroke={P.ink} strokeWidth={2.5} strokeLinecap="round" />
          <path d={`M${skull.x - 13} ${skull.y - 13}A${skull.r} ${skull.r} 0 0 1 ${skull.x + 2} ${skull.y - 19}`} fill="none" stroke={P.steel} strokeWidth={2.5} strokeLinecap="round" />
        </g>
      )}
    </g>
  )
}
