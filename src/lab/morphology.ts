import { type ChainGenome, type ModuleId, MODULE_IDS, PALETTE, type Recovery } from './genome'
import { hashString, rngFrom } from '../lib/random'

export type OrganPart =
  | 'signature'
  | 'keys'
  | 'hash'
  | 'proof'
  | 'pq'
  | 'privacy'
  | 'consensus'
  | 'recovery'
  | 'execution'
  | 'modules'
  | 'economics'

export interface Point {
  x: number
  y: number
}

export interface Tentacle {
  d: string
  base: Point
  tip: Point
  joints: Point[]
  curl: string | null
  delay: number
  duration: number
}

export interface Electron {
  color: string
  begin: number
  x: number
  y: number
}

export interface Orbital {
  d: string
  tilt: number
  duration: number
  electrons: Electron[]
  exotic: boolean
}

export interface Organelle {
  kind: ModuleId
  angle: number
}

export interface Morphology {
  center: number
  radius: number
  membrane: string
  tint: string
  pattern: 'dots' | 'hex' | 'waves'
  bands: number[]
  cilia: { from: Point; to: Point }[]
  stitches: (Point & { angle: number })[]
  nucleus: {
    shape: 'orb' | 'hex' | 'eye' | 'trilobe'
    r: number
    path: string
    lobes: Point[]
    tier: 0 | 1 | 2
  }
  core: 'single' | 'dual' | 'triad'
  proof: { ticks: number; double: boolean } | null
  tentacleStyle: 'smooth' | 'segmented' | 'spiral' | 'angular'
  tentacles: Tentacle[]
  orbitals: Orbital[]
  shield: { kind: 'ring' | 'lattice'; r: number; particles: Point[]; hexes: string[] } | null
  cloud: { blobs: (Point & { r: number })[]; full: boolean } | null
  recovery: {
    kind: Recovery
    angle: number
    pods: Point[]
    beads: (Point & { lit: boolean })[]
    beadArc: string
    skull: (Point & { r: number }) | null
    tether: { from: Point; to: Point } | null
  }
  satellites: { points: Point[]; radius: number; duration: number }
  organelles: Organelle[]
  vents: { angle: number }[]
  treasury: (Point & { r: number }) | null
  speedLines: string[]
  haloColor: string
  generation: number
  mutationCount: number
}

const C = 200
const TINTS = ['#F6F0E1', '#EEF2E1', '#F4E9E0', '#E9EFEE', '#F2ECE5', '#EFEAF2']
const SHAPES: Morphology['nucleus']['shape'][] = ['orb', 'hex', 'eye', 'trilobe']
const STYLE_BY_VM: Record<ChainGenome['execution']['vm'], Morphology['tentacleStyle']> = {
  svm: 'smooth',
  evm: 'segmented',
  move: 'spiral',
  wasm: 'angular',
}

const f = (value: number) => Math.round(value * 10) / 10

export const polar = (angle: number, radius: number, cx = C, cy = C): Point => ({
  x: cx + Math.cos(angle) * radius,
  y: cy + Math.sin(angle) * radius,
})

export function smoothClosed(points: Point[], tension = 1) {
  const n = points.length
  let d = `M${f(points[0].x)} ${f(points[0].y)}`
  for (let index = 0; index < n; index += 1) {
    const p0 = points[(index - 1 + n) % n]
    const p1 = points[index]
    const p2 = points[(index + 1) % n]
    const p3 = points[(index + 2) % n]
    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`
  }
  return `${d}Z`
}

function cubicPoint(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  }
}

function ellipsePath(rx: number, ry: number) {
  return `M${C + rx} ${C}A${rx} ${ry} 0 1 1 ${C - rx} ${C}A${rx} ${ry} 0 1 1 ${C + rx} ${C}`
}

function lemniscatePath(a: number) {
  const points: string[] = []
  for (let step = 0; step <= 64; step += 1) {
    const t = (step / 64) * Math.PI * 2
    const x = C + a * Math.cos(t)
    const y = C + a * 0.62 * Math.sin(t) * Math.cos(t) * 2
    points.push(`${f(x)} ${f(y)}`)
  }
  return `M${points.join('L')}Z`
}

function hexagon(radius: number, rotation: number) {
  const points: string[] = []
  for (let index = 0; index < 6; index += 1) {
    const point = polar(rotation + (index * Math.PI) / 3, radius)
    points.push(`${f(point.x)},${f(point.y)}`)
  }
  return points.join(' ')
}

function blockDuration(blockTime: number) {
  return blockTime === 400 ? 2.6 : blockTime === 1000 ? 6 : 10
}

export function buildMorphology(genome: ChainGenome): Morphology {
  const family = rngFrom(`family:${genome.lineage.family}`)
  const individual = rngFrom(`individual:${genome.identity.name}:${genome.lineage.generation}`)
  const generation = Math.min(genome.lineage.generation, 6)
  const profile = genome.cryptography.profile
  const tier: 0 | 1 | 2 = profile === 'classical' ? 0 : profile === 'hybrid' ? 1 : 2
  const turbo = genome.execution.blockTimeMs === 400
  const orbitDuration = blockDuration(genome.execution.blockTimeMs)

  const radius = Math.min(72 + generation * 3, 88)
  const lobes = 6 + Math.floor(family() * 3) + Math.min(generation, 4)
  const rotation = family() * Math.PI * 2
  const membranePoints: Point[] = []
  for (let index = 0; index < lobes * 2; index += 1) {
    const angle = rotation + (index / (lobes * 2)) * Math.PI * 2
    const swell = index % 2 === 0 ? 0.07 : -0.04
    const r =
      radius * (1 + swell + (family() - 0.5) * 0.1 + (individual() - 0.5) * 0.035)
    membranePoints.push(polar(angle, r))
  }
  const membrane = smoothClosed(membranePoints)
  const tint = TINTS[Math.floor(family() * TINTS.length)]

  const shape = SHAPES[Math.floor(family() * SHAPES.length)]
  const nucleusR = 27 + tier * 2
  let nucleusPath = ''
  const lobePoints: Point[] = []
  if (shape === 'orb') {
    nucleusPath = ellipsePath(nucleusR, nucleusR)
  } else if (shape === 'eye') {
    nucleusPath = ellipsePath(nucleusR * 1.22, nucleusR * 0.86)
  } else if (shape === 'hex') {
    const hexPoints: Point[] = []
    for (let index = 0; index < 6; index += 1) {
      hexPoints.push(polar(rotation + (index * Math.PI) / 3, nucleusR * 1.1))
    }
    nucleusPath = smoothClosed(hexPoints, 0.45)
  } else {
    for (let index = 0; index < 3; index += 1) {
      lobePoints.push(polar(rotation + (index * Math.PI * 2) / 3, nucleusR * 0.42))
    }
  }

  const baseTentacles = 3 + Math.floor(family() * 3)
  const tentacleCount = Math.min(
    baseTentacles +
      (genome.execution.modules.length >= 3 ? 1 : 0) +
      Math.floor(generation / 2),
    9,
  )
  const curlDirection = family() < 0.5 ? -1 : 1
  const tentacleStyle = STYLE_BY_VM[genome.execution.vm]
  const tentacleOffset = family() * Math.PI * 2
  const tentacles: Tentacle[] = []
  for (let index = 0; index < tentacleCount; index += 1) {
    const familyJitter = (family() - 0.5) * 0.5
    const angle =
      tentacleOffset +
      (index / tentacleCount) * Math.PI * 2 +
      familyJitter +
      (individual() - 0.5) * 0.18
    const length = Math.min(52 + family() * 42 + individual() * 10, 160 - radius)
    const curl = curlDirection * (16 + family() * 22) * (index % 2 === 0 ? 1 : -0.7)
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) }
    const base = polar(angle, radius - 8)
    const tip = polar(angle, radius + length)
    const p1 = polar(angle, radius + length * 0.35)
    const p2 = polar(angle, radius + length * 0.72)
    const c1 = { x: p1.x + normal.x * curl, y: p1.y + normal.y * curl }
    const c2 = { x: p2.x - normal.x * curl * 0.6, y: p2.y - normal.y * curl * 0.6 }
    let d = `M${f(base.x)} ${f(base.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(tip.x)} ${f(tip.y)}`
    if (tentacleStyle === 'angular') {
      const a = polar(angle, radius + length * 0.34)
      const b = polar(angle, radius + length * 0.68)
      d = `M${f(base.x)} ${f(base.y)}L${f(a.x + normal.x * curl * 0.55)} ${f(a.y + normal.y * curl * 0.55)}L${f(b.x - normal.x * curl * 0.55)} ${f(b.y - normal.y * curl * 0.55)}L${f(tip.x)} ${f(tip.y)}`
    }
    const joints =
      tentacleStyle === 'segmented'
        ? [0.34, 0.6, 0.83].map((t) => cubicPoint(base, c1, c2, tip, t))
        : []
    let curlPath: string | null = null
    if (tentacleStyle === 'spiral') {
      const out = polar(angle, 9, tip.x, tip.y)
      const side = polar(angle + Math.PI / 2 * curlDirection, 9, tip.x, tip.y)
      curlPath = `M${f(tip.x)} ${f(tip.y)}Q${f(out.x)} ${f(out.y)} ${f(side.x)} ${f(side.y)}`
    }
    tentacles.push({
      d,
      base,
      tip,
      joints,
      curl: curlPath,
      delay: -family() * 4,
      duration: 3.6 + family() * 2.4,
    })
  }

  const tilt = family() * 180
  const orbitals: Orbital[] = []
  const electronAt = (rx: number, ry: number, angle: number, rotationDeg: number) => {
    const local = { x: Math.cos(angle) * rx, y: Math.sin(angle) * ry }
    const rad = (rotationDeg * Math.PI) / 180
    return {
      x: C + local.x * Math.cos(rad) - local.y * Math.sin(rad),
      y: C + local.x * Math.sin(rad) + local.y * Math.cos(rad),
    }
  }
  const pushEllipse = (rx: number, ry: number, rotationDeg: number, colors: string[]) => {
    orbitals.push({
      d: ellipsePath(rx, ry),
      tilt: rotationDeg,
      duration: orbitDuration * (0.85 + family() * 0.3),
      exotic: false,
      electrons: colors.map((color, index) => {
        const begin = index / colors.length
        const position = electronAt(rx, ry, begin * Math.PI * 2, rotationDeg)
        return { color, begin, ...position }
      }),
    })
  }
  pushEllipse(radius + 50, 34 + family() * 10, tilt, [PALETTE.cyan])
  if (tier >= 1) pushEllipse(radius + 44, 30 + family() * 8, tilt + 62, [PALETTE.yellow, PALETTE.yellow])
  if (tier === 2) {
    const a = radius + 56
    orbitals.push({
      d: lemniscatePath(a),
      tilt: tilt - 50,
      duration: orbitDuration * 1.4,
      exotic: true,
      electrons: [
        { color: PALETTE.red, begin: 0, ...electronAt(a, 0, 0, tilt - 50) },
        { color: PALETTE.yellow, begin: 0.5, ...electronAt(-a, 0, 0, tilt - 50) },
      ],
    })
  }

  let shield: Morphology['shield'] = null
  if (tier >= 1) {
    const r = radius + (tier === 1 ? 20 : 26)
    const particles: Point[] = []
    for (let index = 0; index < 6; index += 1) {
      particles.push(polar(rotation + (index * Math.PI) / 3 + 0.3, r))
    }
    shield = {
      kind: tier === 1 ? 'ring' : 'lattice',
      r,
      particles,
      hexes: tier === 2 ? [hexagon(r, rotation), hexagon(r + 10, rotation + 0.5)] : [],
    }
  }

  let cloud: Morphology['cloud'] = null
  if (genome.privacy !== 'public') {
    const full = genome.privacy === 'private-first'
    const blobs: (Point & { r: number })[] = []
    const start = family() * Math.PI * 2
    const span = full ? Math.PI * 2 : Math.PI * 1.15
    const count = full ? 10 : 6
    for (let index = 0; index < count; index += 1) {
      const angle = start + (index / (full ? count : count - 1)) * span
      const distance = nucleusR * (0.88 + family() * 0.2)
      blobs.push({ ...polar(angle, distance), r: nucleusR * (0.5 + family() * 0.2) })
    }
    if (full) {
      blobs.push({ x: C, y: C, r: nucleusR * 0.95 })
      blobs.push({ ...polar(start + 1, nucleusR * 0.35), r: nucleusR * 0.7 })
    } else {
      blobs.push({ ...polar(start + span / 2, nucleusR * 0.4), r: nucleusR * 0.62 })
    }
    cloud = { blobs, full }
  }

  const recoveryAngle = Math.PI * 0.5 + (family() - 0.5) * 1.6
  const recovery: Morphology['recovery'] = {
    kind: genome.recovery,
    angle: recoveryAngle,
    pods: [],
    beads: [],
    beadArc: '',
    skull: null,
    tether: null,
  }
  if (genome.recovery === 'multisig') {
    recovery.pods = [
      polar(recoveryAngle - 0.26, radius + 14),
      polar(recoveryAngle + 0.26, radius + 14),
    ]
  } else if (genome.recovery === 'threshold') {
    const arcRadius = radius + 15
    for (let index = 0; index < 5; index += 1) {
      const angle = recoveryAngle - 0.6 + (index / 4) * 1.2
      recovery.beads.push({ ...polar(angle, arcRadius), lit: index < 3 })
    }
    const from = polar(recoveryAngle - 0.6, arcRadius)
    const to = polar(recoveryAngle + 0.6, arcRadius)
    recovery.beadArc = `M${f(from.x)} ${f(from.y)}A${arcRadius} ${arcRadius} 0 0 1 ${f(to.x)} ${f(to.y)}`
  } else if (genome.recovery === 'deadman') {
    const skullAngle = recoveryAngle - Math.PI
    const skull = { ...polar(skullAngle, radius + 38), r: 20 }
    recovery.skull = skull
    recovery.tether = { from: polar(skullAngle, radius - 2), to: polar(skullAngle, radius + 20) }
  }

  const satelliteCount = Math.max(3, Math.min(18, Math.round(genome.execution.validators / 6)))
  const satelliteOffset = family() * Math.PI * 2
  const satellites = {
    radius: 182,
    duration: turbo ? 40 : 90,
    points: Array.from({ length: satelliteCount }, (_, index) =>
      polar(satelliteOffset + (index / satelliteCount) * Math.PI * 2, 182),
    ),
  }

  const moduleOffset = family() * Math.PI * 2
  const moduleAngles = MODULE_IDS.map(
    (_, index) => moduleOffset + (index / MODULE_IDS.length) * Math.PI * 2 + (family() - 0.5) * 0.3,
  )
  const organelles: Organelle[] = genome.execution.modules.map((kind) => ({
    kind,
    angle: moduleAngles[MODULE_IDS.indexOf(kind)] + (individual() - 0.5) * 0.08,
  }))

  const ciliaCount = Math.min(6 + generation * 4, 26)
  const cilia = Array.from({ length: ciliaCount }, () => {
    const angle = individual() * Math.PI * 2
    return { from: polar(angle, radius + 3), to: polar(angle, radius + 11 + individual() * 4) }
  })

  const bands = Array.from({ length: Math.min(generation, 4) }, (_, index) => 0.86 - index * 0.11)

  const stitches = genome.lineage.mutations.slice(0, 7).map((mutation, index) => {
    const angle = (hashString(`${genome.lineage.family}:${mutation}:${index}`) / 4294967296) * Math.PI * 2
    return { ...polar(angle, radius * 0.93), angle: (angle * 180) / Math.PI }
  })

  const ventCount = Math.round(genome.economics.burnPct / 25)
  const vents = Array.from({ length: ventCount }, (_, index) => ({
    angle: Math.PI * 0.5 + (index - (ventCount - 1) / 2) * 0.32,
  }))
  const treasury =
    genome.economics.treasuryPct > 0
      ? {
          ...polar(rotation + Math.PI * 1.25, radius * 0.66),
          r: 6 + genome.economics.treasuryPct * 0.32,
        }
      : null

  const speedLines = turbo
    ? [0, 1, 2].map((index) => {
        const start = tilt * (Math.PI / 180) + index * 2.1
        const r = 150 + index * 9
        const from = polar(start, r)
        const to = polar(start + 0.62, r)
        return `M${f(from.x)} ${f(from.y)}A${r} ${r} 0 0 1 ${f(to.x)} ${f(to.y)}`
      })
    : []

  return {
    center: C,
    radius,
    membrane,
    tint,
    pattern: tier === 0 ? 'dots' : tier === 1 ? 'hex' : 'waves',
    bands,
    cilia,
    stitches,
    nucleus: { shape, r: nucleusR, path: nucleusPath, lobes: lobePoints, tier },
    core: tier === 0 ? 'single' : tier === 1 ? 'dual' : 'triad',
    proof:
      genome.privacy === 'public'
        ? null
        : { ticks: tier === 0 ? 12 : tier === 1 ? 24 : 36, double: tier === 2 },
    tentacleStyle,
    tentacles,
    orbitals,
    shield,
    cloud,
    recovery,
    satellites,
    organelles,
    vents,
    treasury,
    speedLines,
    haloColor: tier === 2 ? PALETTE.yellow : genome.recovery === 'deadman' ? '#C9C2B2' : PALETTE.lime,
    generation,
    mutationCount: genome.lineage.mutations.length,
  }
}
