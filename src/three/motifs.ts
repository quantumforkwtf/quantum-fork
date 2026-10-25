import * as THREE from 'three'
import { damp, disposeObject, dot, GLOW } from './core'
import type { LayerKind, LayerSpec, MotifKind } from './types'

/**
 * Blueprint motifs: thin-line structures that sit around an organism inside the
 * same scene (vault shells, payment paths, agent orbits…). They add no WebGL
 * context of their own. `activity` runs from idle (subtle) to fully active.
 */

const TAU = Math.PI * 2

export interface MotifHandle {
  group: THREE.Group
  readonly presence: number
  readonly presenceTarget: number
  setActivity(level: number, immediate?: boolean): void
  setPresence(level: number, immediate?: boolean): void
  update(dt: number, t: number): void
  dispose(): void
}

interface Faded {
  material: THREE.Material & { opacity: number }
  base: number
  /** Share of the base opacity kept while idle. */
  floor: number
}

interface Context {
  group: THREE.Group
  fade<M extends THREE.Material & { opacity: number }>(material: M, base: number, floor?: number): M
}

type Tick = (dt: number, t: number, activity: number) => void

const ADDITIVE = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false } as const

const line = (color: number) => new THREE.LineBasicMaterial({ color, ...ADDITIVE })
const points = (color: number, size: number, vertexColors = false) => new THREE.PointsMaterial({ color: vertexColors ? 0xffffff : color, size, map: dot(), sizeAttenuation: true, vertexColors, ...ADDITIVE })
const solid = (color: number) => new THREE.MeshBasicMaterial({ color, ...ADDITIVE })

function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function fibonacciSphere(count: number, radius: number) {
  const array = new Float32Array(count * 3)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const angle = golden * index
    array.set([Math.cos(angle) * r * radius, y * radius, Math.sin(angle) * r * radius], index * 3)
  }
  return array
}

function ring(radius: number, material: THREE.LineBasicMaterial, segments = 160) {
  const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, TAU)
  const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(segments).map((point) => new THREE.Vector3(point.x, 0, point.y)))
  return new THREE.LineLoop(geometry, material)
}

/* ---------- motifs ---------- */

function vault(ctx: Context): Tick {
  const shells = [
    { radius: 2.18, color: GLOW.white, spin: 0.06 },
    { radius: 2.46, color: GLOW.cyan, spin: -0.09 },
    { radius: 2.74, color: GLOW.lime, spin: 0.05 },
  ].map((spec, index) => {
    const geometry = new THREE.IcosahedronGeometry(spec.radius, 1)
    const group = new THREE.Group()
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), ctx.fade(line(spec.color), 0.3 - index * 0.04, 0.25)))
    group.add(new THREE.Points(geometry, ctx.fade(points(spec.color, 0.05), 0.55, 0.2)))
    group.rotation.set(index * 0.6, index * 0.9, 0)
    ctx.group.add(group)
    return { group, ...spec, index }
  })
  return (dt, _t, activity) => {
    for (const shell of shells) {
      shell.group.rotation.y += dt * shell.spin * (1 + activity)
      shell.group.scale.setScalar(1 + (1 - activity) * (0.16 + shell.index * 0.1))
    }
  }
}

function payments(ctx: Context): Tick {
  const count = 7
  const nodes: THREE.Vector3[] = []
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * TAU
    nodes.push(new THREE.Vector3(Math.cos(angle) * 2.6, (index % 2 ? 0.42 : -0.32) * (index % 3 ? 1 : -1), Math.sin(angle) * 2.6))
  }
  const nodeGeometry = new THREE.SphereGeometry(0.06, 14, 10)
  for (const node of nodes) {
    const mesh = new THREE.Mesh(nodeGeometry, ctx.fade(solid(GLOW.yellow), 0.95, 0.45))
    mesh.position.copy(node)
    ctx.group.add(mesh)
  }
  const curves: THREE.QuadraticBezierCurve3[] = []
  for (let index = 0; index < count; index += 1) {
    for (const step of [2, 3]) {
      const a = nodes[index]
      const b = nodes[(index + step) % count]
      const control = a.clone().add(b).multiplyScalar(0.18).setY((a.y + b.y) * 0.5 + 0.9)
      curves.push(new THREE.QuadraticBezierCurve3(a, control, b))
    }
  }
  const pathMaterial = ctx.fade(line(GLOW.yellow), 0.2, 0.18)
  for (const curve of curves) ctx.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), pathMaterial))
  const perPath = 3
  const seeds = Array.from({ length: curves.length * perPath }, (_, index) => (index % perPath) / perPath + (index * 0.137) % 0.2)
  const positions = new Float32Array(seeds.length * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const particles = new THREE.Points(geometry, ctx.fade(points(GLOW.white, 0.075), 1, 0.25))
  particles.frustumCulled = false
  ctx.group.add(particles)
  const at = new THREE.Vector3()
  let travel = 0
  return (dt, _t, activity) => {
    travel += dt * (0.05 + activity * 0.28)
    for (let index = 0; index < seeds.length; index += 1) {
      curves[Math.floor(index / perPath)].getPoint((seeds[index] + travel) % 1, at)
      positions.set([at.x, at.y, at.z], index * 3)
    }
    geometry.attributes.position.needsUpdate = true
  }
}

function membrane(ctx: Context): Tick {
  const radius = 2.36
  const skin = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(fibonacciSphere(900, radius), 3)), ctx.fade(points(GLOW.purple, 0.04), 0.75, 0.3))
  const body = new THREE.Group()
  body.add(skin)
  for (let index = 1; index < 7; index += 1) {
    const y = -radius + (index / 7) * radius * 2
    const latitude = ring(Math.sqrt(radius * radius - y * y), ctx.fade(line(GLOW.purple), 0.14, 0.2), 120)
    latitude.position.y = y
    body.add(latitude)
  }
  const veil = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.98, 48, 32), ctx.fade(new THREE.MeshBasicMaterial({ color: GLOW.purple, side: THREE.BackSide, ...ADDITIVE }), 0.05, 0.3))
  body.add(veil)
  ctx.group.add(body)
  return (dt, t, activity) => {
    body.rotation.y += dt * 0.05
    body.scale.setScalar(1.14 - activity * 0.14 + Math.sin(t * 0.9) * 0.012)
  }
}

function agents(ctx: Context, count = 5): Tick {
  const rng = seeded(5)
  const colors = [GLOW.green, GLOW.cyan, GLOW.lime, GLOW.green, GLOW.cyan].slice(0, Math.max(1, Math.min(5, count)))
  const agentGeometry = new THREE.OctahedronGeometry(0.09, 0)
  const items = colors.map((color, index) => {
    const orbit = new THREE.Group()
    orbit.rotation.set((rng() - 0.5) * 1.3, rng() * TAU, (rng() - 0.5) * 0.9)
    const radius = 2.25 + index * 0.13
    orbit.add(ring(radius, ctx.fade(line(color), 0.16, 0.25), 140))
    const agent = new THREE.Mesh(agentGeometry, ctx.fade(solid(color), 1, 0.5))
    orbit.add(agent)
    const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), ctx.fade(line(color), 0.35, 0))
    orbit.add(tether)
    ctx.group.add(orbit)
    return { agent, tether, radius, phase: rng() * TAU, rate: 0.25 + rng() * 0.25 }
  })
  return (dt, t, activity) => {
    for (const item of items) {
      item.phase += dt * item.rate * (0.6 + activity)
      const x = Math.cos(item.phase) * item.radius
      const z = Math.sin(item.phase) * item.radius
      item.agent.position.set(x, 0, z)
      item.agent.rotation.y += dt * 1.4
      const positions = item.tether.geometry.attributes.position as THREE.BufferAttribute
      const reach = 0.55 + 0.45 * Math.max(0, Math.sin(t * 1.3 + item.phase * 2))
      positions.setXYZ(0, x * (1 - reach * 0.55), 0, z * (1 - reach * 0.55))
      positions.setXYZ(1, x, 0, z)
      positions.needsUpdate = true
    }
  }
}

function enterprise(ctx: Context): Tick {
  const count = 8
  const radius = 2.62
  const body = new THREE.Group()
  const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(2.06, 2.06, 2.5, 6, 1, true)), ctx.fade(line(GLOW.cyan), 0.26, 0.3))
  body.add(cage)
  const box = new THREE.BoxGeometry(0.17, 0.17, 0.17)
  const edges = new THREE.EdgesGeometry(box)
  const nodeLine = ctx.fade(line(GLOW.white), 0.75, 0.4)
  const nodeCore = ctx.fade(solid(GLOW.cyan), 0.35, 0.3)
  const nodes: THREE.Vector3[] = []
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * TAU
    const position = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    nodes.push(position)
    const frame = new THREE.LineSegments(edges, nodeLine)
    frame.position.copy(position)
    frame.rotation.y = -angle
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), nodeCore)
    core.position.copy(position)
    body.add(frame, core)
  }
  const perimeter = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(nodes), ctx.fade(line(GLOW.white), 0.14, 0.4))
  body.add(perimeter)
  const spokes: number[] = []
  for (const node of nodes) {
    const inner = node.clone().setLength(2.06)
    spokes.push(node.x, node.y, node.z, inner.x, inner.y, inner.z)
  }
  const spokeGeometry = new THREE.BufferGeometry()
  spokeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(spokes, 3))
  body.add(new THREE.LineSegments(spokeGeometry, ctx.fade(line(GLOW.cyan), 0.32, 0.1)))
  const pulses = new Float32Array(count * 3)
  const pulseGeometry = new THREE.BufferGeometry()
  pulseGeometry.setAttribute('position', new THREE.BufferAttribute(pulses, 3))
  const pulse = new THREE.Points(pulseGeometry, ctx.fade(points(GLOW.cyan, 0.09), 1, 0))
  pulse.frustumCulled = false
  body.add(pulse)
  ctx.group.add(body)
  return (dt, t) => {
    body.rotation.y += dt * 0.07
    for (let index = 0; index < count; index += 1) {
      const k = (t * 0.6 + index / count) % 1
      const length = radius - k * (radius - 2.06)
      pulses.set([(nodes[index].x / radius) * length, 0, (nodes[index].z / radius) * length], index * 3)
    }
    pulseGeometry.attributes.position.needsUpdate = true
  }
}

function scanner(ctx: Context, ringColor: number, found: number, upgraded: number): Tick {
  const gantry = new THREE.Group()
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.007, 6, 180), ctx.fade(solid(ringColor), 0.95, 0.35))
  hoop.rotation.x = Math.PI / 2
  const sheet = new THREE.Mesh(new THREE.CircleGeometry(2.32, 96), ctx.fade(new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide, ...ADDITIVE }), 0.06, 0.3))
  sheet.rotation.x = -Math.PI / 2
  gantry.add(hoop, sheet)
  ctx.group.add(gantry)
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(2.32, 2.32, 3.4, 4, 1, true)), ctx.fade(line(ringColor), 0.1, 0.3))
  frame.rotation.y = Math.PI / 4
  ctx.group.add(frame)

  const count = 18
  const markers = fibonacciSphere(count, 2.02)
  const colors = new Float32Array(count * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(markers, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  ctx.group.add(new THREE.Points(geometry, ctx.fade(points(0xffffff, 0.13, true), 1, 0.35)))
  const heat = new Float32Array(count)
  const foundColor = new THREE.Color(found)
  const upgradeColor = new THREE.Color(upgraded)
  const idle = new THREE.Color(0x2a2d31)
  const mixed = new THREE.Color()
  let sweep = 0
  return (dt, _t, activity) => {
    sweep += dt * (0.35 + activity * 0.5)
    const y = Math.sin(sweep) * 1.7
    gantry.position.y = y
    for (let index = 0; index < count; index += 1) {
      if (Math.abs(markers[index * 3 + 1] - y) < 0.14) heat[index] = 1
      heat[index] = Math.max(0, heat[index] - dt * 0.35)
      mixed.copy(idle).lerp(foundColor, Math.min(1, heat[index] * 1.4 + 0.25))
      if (activity > 0.5) mixed.lerp(upgradeColor, (activity - 0.5) * 2 * (1 - heat[index]))
      colors.set([mixed.r, mixed.g, mixed.b], index * 3)
    }
    geometry.attributes.color.needsUpdate = true
  }
}

function descendant(ctx: Context): Tick {
  const rings = [
    { radius: 2.45, color: GLOW.lime, tilt: 0.38, spin: 0.22 },
    { radius: 2.7, color: GLOW.cyan, tilt: -0.3, spin: -0.15 },
  ].map((spec) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(spec.radius, 0.006, 6, 200), ctx.fade(solid(spec.color), 0.85, 0.3))
    const holder = new THREE.Group()
    mesh.rotation.x = Math.PI / 2 + spec.tilt
    holder.add(mesh)
    ctx.group.add(holder)
    return { holder, ...spec }
  })
  const count = 180
  const rng = seeded(11)
  const seeds = Array.from({ length: count }, () => [rng() * TAU, rng(), 0.6 + rng() * 0.8] as const)
  const positions = new Float32Array(count * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const stream = new THREE.Points(geometry, ctx.fade(points(GLOW.lime, 0.045), 0.9, 0.2))
  stream.frustumCulled = false
  ctx.group.add(stream)
  let flow = 0
  return (dt, t, activity) => {
    flow += dt * (0.08 + activity * 0.3)
    for (const item of rings) item.holder.rotation.y += dt * item.spin * (1 + activity * 2)
    for (let index = 0; index < count; index += 1) {
      const [angle, offset, spread] = seeds[index]
      const k = (offset + flow * spread) % 1
      const height = 3.3 * (1 - k)
      const radius = 0.3 + height * 0.42
      positions.set([Math.cos(angle + t * 0.6) * radius, height, Math.sin(angle + t * 0.6) * radius], index * 3)
    }
    geometry.attributes.position.needsUpdate = true
  }
}

function helix(ctx: Context): Tick {
  const perStrand = 90
  const strands = [GLOW.lime, GLOW.cyan].map((color) => {
    const positions = new Float32Array(perStrand * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const object = new THREE.Points(geometry, ctx.fade(points(color, 0.06), 0.95, 0.3))
    object.frustumCulled = false
    ctx.group.add(object)
    return { positions, geometry }
  })
  const rungCount = 15
  const rungPositions = new Float32Array(rungCount * 6)
  const rungGeometry = new THREE.BufferGeometry()
  rungGeometry.setAttribute('position', new THREE.BufferAttribute(rungPositions, 3))
  const rungs = new THREE.LineSegments(rungGeometry, ctx.fade(line(GLOW.white), 0.22, 0.25))
  rungs.frustumCulled = false
  ctx.group.add(rungs)
  let twist = 0
  return (dt, _t, activity) => {
    twist += dt * (0.25 + activity * 0.5)
    for (let strand = 0; strand < 2; strand += 1) {
      const { positions, geometry } = strands[strand]
      for (let index = 0; index < perStrand; index += 1) {
        const s = index / (perStrand - 1)
        const angle = s * TAU * 1.6 + twist + strand * Math.PI
        positions.set([Math.cos(angle) * 2.4, -2.3 + s * 4.6, Math.sin(angle) * 2.4], index * 3)
      }
      geometry.attributes.position.needsUpdate = true
    }
    for (let index = 0; index < rungCount; index += 1) {
      const point = Math.round((index / (rungCount - 1)) * (perStrand - 1)) * 3
      rungPositions.set([...strands[0].positions.subarray(point, point + 3), ...strands[1].positions.subarray(point, point + 3)], index * 6)
    }
    rungGeometry.attributes.position.needsUpdate = true
  }
}

/** One issued asset: a tilted orbit with a bright bead and a short wake. */
function orbit(ctx: Context, seed: number, index: number): Tick {
  const rng = seeded(seed)
  const color = [GLOW.lime, GLOW.cyan, GLOW.purple, GLOW.yellow][seed % 4]
  const radius = 2.28 + (index % 6) * 0.1
  const holder = new THREE.Group()
  holder.rotation.set((rng() - 0.5) * 1.6, rng() * TAU, (rng() - 0.5) * 1.1)
  holder.add(ring(radius, ctx.fade(line(color), 0.22, 0.35), 180))
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), ctx.fade(solid(color), 1, 0.6))
  holder.add(bead)
  const wakeCount = 26
  const wake = new Float32Array(wakeCount * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(wake, 3))
  const trail = new THREE.Points(geometry, ctx.fade(points(color, 0.045), 0.7, 0.4))
  trail.frustumCulled = false
  holder.add(trail)
  ctx.group.add(holder)
  let phase = rng() * TAU
  const rate = 0.32 + rng() * 0.22
  return (dt, _t, activity) => {
    phase += dt * rate * (0.6 + activity)
    bead.position.set(Math.cos(phase) * radius, 0, Math.sin(phase) * radius)
    for (let k = 0; k < wakeCount; k += 1) {
      const angle = phase - (k + 1) * 0.035
      wake.set([Math.cos(angle) * radius, 0, Math.sin(angle) * radius], k * 3)
    }
    geometry.attributes.position.needsUpdate = true
  }
}

/** One fork: a daughter cell budding off the body, joined by a thinning neck. */
function bud(ctx: Context, seed: number, index: number): Tick {
  const rng = seeded(seed)
  const angle = index * 2.2 + rng() * 0.6
  const lift = (rng() - 0.5) * 1.2
  const direction = new THREE.Vector3(Math.cos(angle), lift * 0.4, Math.sin(angle)).normalize()
  const center = direction.clone().multiplyScalar(2.45)
  const cell = new THREE.Group()
  cell.position.copy(center)
  cell.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(fibonacciSphere(140, 0.3), 3)), ctx.fade(points(GLOW.lime, 0.045), 0.9, 0.4)))
  cell.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), ctx.fade(solid(GLOW.lime), 0.6, 0.5)))
  ctx.group.add(cell)
  const neckCount = 34
  const neck = new Float32Array(neckCount * 3)
  for (let k = 0; k < neckCount; k += 1) {
    const s = k / (neckCount - 1)
    const point = direction.clone().multiplyScalar(1.35 + s * 0.85)
    neck.set([point.x, point.y, point.z], k * 3)
  }
  ctx.group.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(neck, 3)), ctx.fade(points(GLOW.lime, 0.035), 0.55, 0.3)))
  return (dt, t) => {
    cell.rotation.y += dt * 0.4
    cell.scale.setScalar(1 + Math.sin(t * 1.4 + index) * 0.06)
  }
}

const BUILDERS: Record<MotifKind, (ctx: Context) => Tick> = {
  descendant,
  vault,
  payments,
  membrane,
  agents,
  enterprise,
  'app-scan': (ctx) => scanner(ctx, GLOW.orange, GLOW.orange, GLOW.lime),
  'chain-scan': (ctx) => scanner(ctx, GLOW.cyan, GLOW.red, GLOW.lime),
  helix,
}

const LAYER_BUILDERS: Record<LayerKind, (ctx: Context, spec: LayerSpec) => Tick> = {
  orbit: (ctx, spec) => orbit(ctx, spec.seed, spec.index),
  bud: (ctx, spec) => bud(ctx, spec.seed, spec.index),
  membrane,
}

export function buildMotif(kind: MotifKind): MotifHandle {
  return assemble(BUILDERS[kind])
}

/** Motifs drawn to fill a blueprint frame are shrunk to sit around a network organism as one structure among several. */
const LAYER_SCALE: Partial<Record<LayerKind, number>> = { membrane: 0.9 }

/** A structure added by the descendant's own records: a token, a fork. */
export function buildLayer(spec: LayerSpec): MotifHandle {
  const handle = assemble((ctx) => LAYER_BUILDERS[spec.kind](ctx, spec))
  handle.group.scale.setScalar(LAYER_SCALE[spec.kind] ?? 1)
  return handle
}

function assemble(build: (ctx: Context) => Tick): MotifHandle {
  const group = new THREE.Group()
  const faded: Faded[] = []
  const ctx: Context = {
    group,
    fade(material, base, floor = 0.3) {
      faded.push({ material, base, floor })
      material.opacity = 0
      return material
    },
  }
  const tick = build(ctx)
  let activity = 0
  let activityTarget = 0
  let presence = 0
  let presenceTarget = 1

  const apply = () => {
    for (const item of faded) item.material.opacity = item.base * presence * (item.floor + (1 - item.floor) * activity)
    group.visible = presence > 0.004
  }

  return {
    group,
    get presence() {
      return presence
    },
    get presenceTarget() {
      return presenceTarget
    },
    setActivity(level, immediate = false) {
      activityTarget = Math.max(0, Math.min(1, level))
      if (immediate) activity = activityTarget
      apply()
    },
    setPresence(level, immediate = false) {
      presenceTarget = level
      if (immediate) presence = level
      apply()
    },
    update(dt, t) {
      activity = damp(activity, activityTarget, 3.2, dt)
      presence = damp(presence, presenceTarget, 4.5, dt)
      tick(dt, t, activity)
      apply()
    },
    dispose() {
      disposeObject(group)
    },
  }
}
