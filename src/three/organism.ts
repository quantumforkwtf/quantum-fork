import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { type ChainGenome, fingerprint, type ModuleId } from '../lab/genome'
import type { OrganPart } from '../lab/morphology'
import { createRng, hashString } from '../lib/random'
import { disposeObject, dot, GLOW, haloSprite, makeField, randomUnit } from './core'
import { NO_FX, type OrganismFx } from './types'

const TAU = Math.PI * 2

interface Tracked {
  part: OrganPart
  material: THREE.Material & { opacity: number; emissiveIntensity?: number; emissive?: THREE.Color; color?: THREE.Color }
  base: number
  key: 'emissiveIntensity' | 'opacity'
  /** The colour the alert overlay tints; emissive for lit meshes, base colour for lines and points. */
  tint: THREE.Color | null
  baseTint: THREE.Color | null
}

const ALERT = new THREE.Color(GLOW.red)
const SCAN_SECONDS = 1.7

export interface OrganismHandle {
  group: THREE.Group
  /** Approximate outer radius including satellites. */
  radius: number
  /** Sample points on the membrane (local space), used for assembly effects. */
  surface: Float32Array
  update(dt: number, t: number): void
  setHighlight(part: OrganPart | null): void
  /** 1 = normal. Above 1 overdrives every glow; below 1 dims. */
  setEnergy(value: number): void
  /** `immediate` applies the overlay without replaying a scan sweep (used after rebuilds). */
  setFx(fx: OrganismFx, immediate?: boolean): void
  dispose(): void
}

export interface OrganismOptions {
  detail?: 'high' | 'low'
}

const SPEED: Record<number, number> = { 2000: 0.6, 1000: 1, 400: 1.85 }

function emissiveMaterial(color: number, intensity: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({
    color: 0x0b0d10,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.35,
    metalness: 0.1,
    ...extra,
  })
}

function glowLine(color: number, opacity: number) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
}

function pointsMaterial(color: number, size: number, opacity: number) {
  return new THREE.PointsMaterial({
    color,
    size,
    map: dot(),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false,
  })
}

export function buildOrganism(genome: ChainGenome, options: OrganismOptions = {}): OrganismHandle {
  const high = options.detail !== 'low'
  const family = createRng(hashString(`family:${genome.lineage.family}`))
  const rng = createRng(hashString(fingerprint(genome)))
  const speed = SPEED[genome.execution.blockTimeMs] ?? 1
  const profile = genome.cryptography.profile
  const privacy = genome.privacy

  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const tracked: Tracked[] = []
  const parts = new Map<OrganPart, THREE.Object3D[]>()
  const animators: ((dt: number, t: number) => void)[] = []

  const track = (part: OrganPart, object: THREE.Object3D) => {
    const list = parts.get(part) ?? []
    list.push(object)
    parts.set(part, list)
    object.traverse((child) => {
      if (child.userData.untracked) return
      const material = (child as THREE.Mesh).material as Tracked['material'] | undefined
      if (!material || Array.isArray(material)) return
      if ('emissiveIntensity' in material && typeof material.emissiveIntensity === 'number' && material.emissiveIntensity > 0) {
        const tint = material.emissive ?? null
        tracked.push({ part, material, base: material.emissiveIntensity, key: 'emissiveIntensity', tint, baseTint: tint?.clone() ?? null })
      } else if (material.transparent) {
        const tint = material.color ?? null
        tracked.push({ part, material, base: material.opacity, key: 'opacity', tint, baseTint: tint?.clone() ?? null })
      }
    })
  }

  /* ---------- body plan (inherited through the family) ---------- */

  const lobes = 2 + Math.floor(family() * 4)
  const lobeAmp = 0.05 + family() * 0.09
  const elongation = 0.86 + family() * 0.3
  const twist = (family() - 0.5) * 1.6
  const field = makeField(family, 5, 1.5)
  const fieldAmp = 0.06 + family() * 0.06
  const tintHue = family()

  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, high ? 28 : 14)
  geometry.deleteAttribute('normal')
  geometry.deleteAttribute('uv')
  geometry = mergeVertices(geometry)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let index = 0; index < position.count; index += 1) {
    v.fromBufferAttribute(position, index)
    const theta = Math.atan2(v.z, v.x)
    const ring = Math.sqrt(Math.max(0, 1 - v.y * v.y))
    const r = 1 + fieldAmp * field(v.x, v.y, v.z) + lobeAmp * Math.cos(lobes * theta + twist * v.y) * ring
    v.multiplyScalar(r)
    v.y *= elongation
    position.setXYZ(index, v.x, v.y, v.z)
  }
  geometry.computeVertexNormals()

  const surfaceCount = 420
  const surface = new Float32Array(surfaceCount * 3)
  for (let index = 0; index < surfaceCount; index += 1) {
    const source = Math.floor(rng() * position.count)
    surface[index * 3] = position.getX(source)
    surface[index * 3 + 1] = position.getY(source)
    surface[index * 3 + 2] = position.getZ(source)
  }

  /* ---------- membrane: privacy sets opacity, PQ sets iridescence ---------- */

  const membraneTint = new THREE.Color().setHSL(0.38 + tintHue * 0.12, 0.35, 0.82)
  const membraneParams: THREE.MeshPhysicalMaterialParameters =
    privacy === 'public'
      ? { color: membraneTint, transmission: 1, roughness: 0.1, thickness: 1.1, attenuationColor: new THREE.Color(0x8fffc8), attenuationDistance: 2.6 }
      : privacy === 'shielded'
        ? { color: 0xd8ccff, transmission: 0.9, roughness: 0.3, thickness: 1.6, attenuationColor: new THREE.Color(0x7a55ff), attenuationDistance: 1.3 }
        : { color: 0x3a2a66, transmission: 0.55, roughness: 0.42, thickness: 2.2, attenuationColor: new THREE.Color(0x4b2bb5), attenuationDistance: 0.55, metalness: 0.15 }

  const membraneMaterial = new THREE.MeshPhysicalMaterial({
    ...membraneParams,
    ior: 1.36,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    iridescence: profile === 'classical' ? 0.15 : profile === 'hybrid' ? 0.75 : 1,
    iridescenceIOR: 1.55,
    iridescenceThicknessRange: profile === 'experimental' ? [420, 980] : [180, 620],
    envMapIntensity: 1.2,
    specularIntensity: 1,
  })
  const breath = { value: 0 }
  const time = { value: 0 }
  membraneMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time
    shader.uniforms.uBreath = breath
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uBreath;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float wobble = sin(position.y * 5.2 + uTime * 1.3) * 0.014 + sin(position.x * 4.1 - uTime * 1.05) * 0.011 + sin(position.z * 6.3 + uTime * 0.8) * 0.008;
        transformed += normal * wobble * uBreath;`,
      )
  }
  membraneMaterial.customProgramCacheKey = () => 'qf-membrane'
  const membrane = new THREE.Mesh(geometry, membraneMaterial)
  body.add(membrane)

  /* ---------- hash: glowing markings across the membrane ---------- */

  {
    const count = profile === 'classical' ? 120 : profile === 'hybrid' ? 200 : 300
    const positions = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const source = Math.floor(rng() * position.count)
      positions[index * 3] = position.getX(source) * 1.012
      positions[index * 3 + 1] = position.getY(source) * 1.012
      positions[index * 3 + 2] = position.getZ(source) * 1.012
    }
    const pointsGeometry = new THREE.BufferGeometry()
    pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const markings = new THREE.Points(pointsGeometry, pointsMaterial(profile === 'experimental' ? GLOW.yellow : GLOW.green, 0.035, privacy === 'private-first' ? 0.45 : 0.75))
    body.add(markings)
    track('hash', markings)
  }

  /* ---------- nucleus: signature scheme ---------- */

  const nucleus = new THREE.Group()
  body.add(nucleus)
  if (profile === 'classical') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 48, 32), emissiveMaterial(GLOW.cyan, 2.4))
    nucleus.add(core, haloSprite(GLOW.cyan, 1.5, 0.55))
  } else if (profile === 'hybrid') {
    const pair = new THREE.Group()
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.2, 40, 28), emissiveMaterial(GLOW.cyan, 2.4))
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 40, 28), emissiveMaterial(GLOW.yellow, 2.4))
    a.position.x = 0.15
    b.position.x = -0.15
    pair.add(a, b, haloSprite(GLOW.yellow, 1.6, 0.45))
    nucleus.add(pair)
    animators.push((dt) => {
      pair.rotation.y += dt * 1.6 * speed
      pair.rotation.z += dt * 0.4
    })
  } else {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 1), emissiveMaterial(GLOW.red, 2.6, { flatShading: true }))
    const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.36, 1)), glowLine(GLOW.yellow, 0.8))
    nucleus.add(core, cage, haloSprite(GLOW.red, 1.6, 0.5))
    animators.push((dt) => {
      core.rotation.y += dt * 0.6
      cage.rotation.y -= dt * 0.9
      cage.rotation.x += dt * 0.3
    })
  }
  track('signature', nucleus)

  /* ---------- keys: crystals around the nucleus ---------- */

  {
    const keys = new THREE.Group()
    const count = profile === 'classical' ? 1 : profile === 'hybrid' ? 2 : 4
    for (let index = 0; index < count; index += 1) {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.065, 0), emissiveMaterial(GLOW.lime, 2.2, { flatShading: true }))
      const angle = (index / count) * TAU
      crystal.position.set(Math.cos(angle) * 0.5, Math.sin(angle * 2) * 0.12, Math.sin(angle) * 0.5)
      keys.add(crystal)
    }
    body.add(keys)
    track('keys', keys)
    animators.push((dt) => {
      keys.rotation.y += dt * 0.7 * speed
      keys.children.forEach((child) => (child.rotation.y += dt * 2))
    })
  }

  /* ---------- proof system (shielded species only) ---------- */

  if (privacy !== 'public') {
    const shape =
      profile === 'classical'
        ? new THREE.OctahedronGeometry(0.62, 0)
        : profile === 'hybrid'
          ? new THREE.DodecahedronGeometry(0.62, 0)
          : new THREE.IcosahedronGeometry(0.62, 1)
    const proof = new THREE.LineSegments(new THREE.EdgesGeometry(shape), glowLine(GLOW.cyan, 0.55))
    shape.dispose()
    body.add(proof)
    track('proof', proof)
    animators.push((dt) => {
      proof.rotation.y += dt * 0.35
      proof.rotation.z += dt * 0.18
    })
  }

  /* ---------- privacy: shielding cloud ---------- */

  if (privacy !== 'public') {
    const count = privacy === 'shielded' ? (high ? 520 : 260) : high ? 1100 : 520
    const positions = new Float32Array(count * 3)
    const dir = new THREE.Vector3()
    for (let index = 0; index < count; index += 1) {
      randomUnit(rng, dir).multiplyScalar(0.32 + Math.pow(rng(), 0.7) * 0.5)
      positions.set([dir.x, dir.y * elongation, dir.z], index * 3)
    }
    const cloudGeometry = new THREE.BufferGeometry()
    cloudGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const cloud = new THREE.Points(cloudGeometry, pointsMaterial(GLOW.purple, privacy === 'shielded' ? 0.05 : 0.06, privacy === 'shielded' ? 0.5 : 0.75))
    body.add(cloud)
    track('privacy', cloud)
    animators.push((dt) => {
      cloud.rotation.y -= dt * 0.25
      cloud.rotation.x += dt * 0.08
    })
  }
  track('privacy', membrane)

  /* ---------- PQ profile: electron rings and lattice cage ---------- */

  if (profile !== 'classical') {
    const rings = new THREE.Group()
    const count = profile === 'hybrid' ? 2 : 3
    const electrons: { mesh: THREE.Object3D; ring: THREE.Object3D; radius: number; phase: number; rate: number }[] = []
    for (let index = 0; index < count; index += 1) {
      const radius = 1.42 + index * 0.13
      const ring = new THREE.Group()
      ring.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.0055, 6, 200),
        new THREE.MeshBasicMaterial({ color: index === 2 ? GLOW.red : GLOW.yellow, transparent: true, opacity: 0.7, toneMapped: false }),
      )
      ring.add(torus)
      for (let e = 0; e < 2; e += 1) {
        const electron = new THREE.Group()
        electron.add(
          new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: GLOW.white, toneMapped: false })),
          haloSprite(GLOW.yellow, 0.32, 0.8),
        )
        ring.add(electron)
        electrons.push({ mesh: electron, ring, radius, phase: e * Math.PI + rng() * 0.6, rate: (0.9 + rng() * 0.5) * speed })
      }
      rings.add(ring)
    }
    if (profile === 'experimental') {
      const lattice = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.32, 1)), glowLine(GLOW.red, 0.22))
      lattice.scale.y = elongation
      rings.add(lattice)
      animators.push((dt) => (lattice.rotation.y += dt * 0.12))
    }
    root.add(rings)
    track('pq', rings)
    animators.push((dt, t) => {
      for (const electron of electrons) {
        const angle = electron.phase + t * electron.rate
        electron.mesh.position.set(Math.cos(angle) * electron.radius, Math.sin(angle) * electron.radius, 0)
      }
      rings.rotation.y += dt * 0.08
    })
  }

  /* ---------- consensus: validator satellites ---------- */

  {
    const satellites = new THREE.Group()
    const count = Math.max(1, Math.min(16, Math.round(genome.execution.validators / 8)))
    const radius = 1.95
    satellites.rotation.set(0.35 + family() * 0.5, 0, (family() - 0.5) * 0.6)
    const path = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.003, 4, 220),
      new THREE.MeshBasicMaterial({ color: GLOW.lime, transparent: true, opacity: 0.16, toneMapped: false }),
    )
    path.rotation.x = Math.PI / 2
    satellites.add(path)
    const sphere = new THREE.SphereGeometry(0.05, 20, 14)
    const metal = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.9, roughness: 0.22, emissive: GLOW.lime, emissiveIntensity: 0.35 })
    const nodes: THREE.Mesh[] = []
    for (let index = 0; index < count; index += 1) {
      const node = new THREE.Mesh(sphere, metal)
      node.userData.angle = (index / count) * TAU
      nodes.push(node)
      satellites.add(node)
    }
    root.add(satellites)
    track('consensus', satellites)
    animators.push((dt, t) => {
      for (const node of nodes) {
        const angle = node.userData.angle + t * 0.35 * speed
        node.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
      }
    })
  }

  /* ---------- execution: VM appendages ---------- */

  {
    const appendages = new THREE.Group()
    const vm = genome.execution.vm
    const anchor = (dir: THREE.Vector3) => {
      const scale = 1 + fieldAmp * field(dir.x, dir.y, dir.z)
      return dir.clone().multiplyScalar(scale).setY(dir.y * scale * elongation)
    }
    if (vm === 'svm') {
      const tendrils = 6 + lobes
      const beads = high ? 13 : 9
      const mesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 14, 10),
        new THREE.MeshPhysicalMaterial({ color: 0xe8fff4, roughness: 0.25, metalness: 0, clearcoat: 1, emissive: GLOW.green, emissiveIntensity: 0.25 }),
        tendrils * beads,
      )
      const dirs = Array.from({ length: tendrils }, () => {
        const dir = randomUnit(family)
        dir.y *= 0.75
        return dir.normalize()
      })
      const tips: THREE.Sprite[] = dirs.map(() => haloSprite(GLOW.lime, 0.22, 0.9))
      tips.forEach((tip) => appendages.add(tip))
      const matrix = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      const p = new THREE.Vector3()
      const side = new THREE.Vector3()
      const up = new THREE.Vector3(0, 1, 0)
      animators.push((_dt, t) => {
        dirs.forEach((dir, d) => {
          side.crossVectors(dir, up).normalize()
          const base = anchor(dir)
          for (let b = 0; b < beads; b += 1) {
            const f = b / beads
            const sway = Math.sin(t * 1.6 * speed + d * 1.7 + b * 0.45) * 0.05 * b
            p.copy(base).addScaledVector(dir, b * 0.075).addScaledVector(side, sway).addScaledVector(up, Math.cos(t * speed + d + b * 0.3) * 0.015 * b)
            s.setScalar(0.052 * (1 - f * 0.8))
            matrix.compose(p, q, s)
            mesh.setMatrixAt(d * beads + b, matrix)
            if (b === beads - 1) tips[d].position.copy(p)
          }
        })
        mesh.instanceMatrix.needsUpdate = true
      })
      appendages.add(mesh)
    } else if (vm === 'evm') {
      const count = 9 + lobes * 2
      const cone = new THREE.ConeGeometry(0.055, 0.42, 6)
      cone.translate(0, 0.21, 0)
      const material = new THREE.MeshPhysicalMaterial({ color: 0xc7d0ff, metalness: 0.15, roughness: 0.12, clearcoat: 1, emissive: GLOW.cyan, emissiveIntensity: 0.35, flatShading: true })
      const spikes: THREE.Mesh[] = []
      for (let index = 0; index < count; index += 1) {
        const dir = randomUnit(family).normalize()
        const spike = new THREE.Mesh(cone, material)
        spike.position.copy(anchor(dir)).multiplyScalar(0.96)
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
        spike.userData.phase = family() * TAU
        spike.userData.len = 0.7 + family() * 0.6
        spikes.push(spike)
        appendages.add(spike)
      }
      animators.push((_dt, t) => {
        for (const spike of spikes) spike.scale.set(1, spike.userData.len * (1 + Math.sin(t * 1.4 * speed + spike.userData.phase) * 0.08), 1)
      })
    } else if (vm === 'move') {
      const count = 5 + Math.floor(family() * 4)
      const material = new THREE.MeshPhysicalMaterial({ color: 0xf5e9ff, transparent: true, opacity: 0.78, roughness: 0.18, clearcoat: 1, emissive: GLOW.pink, emissiveIntensity: 0.3 })
      const bulbs: THREE.Mesh[] = []
      for (let index = 0; index < count; index += 1) {
        const dir = randomUnit(family).normalize()
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16 + family() * 0.12, 32, 24), material)
        bulb.position.copy(anchor(dir)).multiplyScalar(1.02)
        bulb.userData.phase = family() * TAU
        bulbs.push(bulb)
        appendages.add(bulb)
      }
      animators.push((_dt, t) => {
        for (const bulb of bulbs) bulb.scale.setScalar(1 + Math.sin(t * 1.2 * speed + bulb.userData.phase) * 0.07)
      })
    } else {
      const count = 6 + Math.floor(family() * 4)
      const plate = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 6)
      const edges = new THREE.EdgesGeometry(plate)
      const metal = new THREE.MeshStandardMaterial({ color: 0x343a44, metalness: 0.85, roughness: 0.28, emissive: GLOW.purple, emissiveIntensity: 0.25 })
      const ringGroup = new THREE.Group()
      ringGroup.rotation.z = (family() - 0.5) * 0.7
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * TAU
        const holder = new THREE.Group()
        holder.position.set(Math.cos(angle) * 1.38, Math.sin(angle * 3) * 0.08, Math.sin(angle) * 1.38)
        holder.lookAt(0, holder.position.y, 0)
        const mesh = new THREE.Mesh(plate, metal)
        mesh.rotation.x = Math.PI / 2
        const outline = new THREE.LineSegments(edges, glowLine(GLOW.cyan, 0.7))
        outline.rotation.x = Math.PI / 2
        holder.add(mesh, outline)
        ringGroup.add(holder)
      }
      appendages.add(ringGroup)
      animators.push((dt) => (ringGroup.rotation.y += dt * 0.3 * speed))
    }
    body.add(appendages)
    track('execution', appendages)
  }

  /* ---------- native modules: organelles ---------- */

  {
    const organelles = new THREE.Group()
    const colors: Record<ModuleId, number> = { bridge: GLOW.cyan, oracle: GLOW.white, governance: GLOW.pink, names: GLOW.yellow, dex: GLOW.orange }
    genome.execution.modules.forEach((module, index) => {
      const holder = new THREE.Group()
      const angle = (index / Math.max(1, genome.execution.modules.length)) * TAU + rng()
      holder.position.set(Math.cos(angle) * 0.62, (rng() - 0.5) * 0.5, Math.sin(angle) * 0.62)
      const color = colors[module]
      const material = emissiveMaterial(color, 1.8)
      if (module === 'bridge') holder.add(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 10, 32), material))
      else if (module === 'oracle') holder.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 14), material))
      else if (module === 'governance') {
        for (let k = 0; k < 3; k += 1) {
          const node = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), material)
          node.position.set(Math.cos((k / 3) * TAU) * 0.06, Math.sin((k / 3) * TAU) * 0.06, 0)
          holder.add(node)
        }
      } else if (module === 'names') holder.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.09, 4, 10), material))
      else {
        const a = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), material)
        const b = a.clone()
        a.position.x = -0.045
        b.position.x = 0.045
        holder.add(a, b)
      }
      holder.add(haloSprite(color, 0.4, 0.5))
      holder.userData.spin = 0.6 + rng()
      organelles.add(holder)
    })
    body.add(organelles)
    track('modules', organelles)
    animators.push((dt) => {
      organelles.rotation.y += dt * 0.2
      organelles.children.forEach((child) => {
        child.rotation.x += dt * child.userData.spin
        child.rotation.y += dt * child.userData.spin * 0.7
      })
    })
  }

  /* ---------- economics: treasury sac and fee-burn embers ---------- */

  {
    const economics = new THREE.Group()
    const { treasuryPct, burnPct } = genome.economics
    if (treasuryPct > 0) {
      const sac = new THREE.Mesh(
        new THREE.SphereGeometry(0.1 + (treasuryPct / 30) * 0.14, 32, 24),
        new THREE.MeshStandardMaterial({ color: GLOW.gold, metalness: 1, roughness: 0.22, emissive: GLOW.gold, emissiveIntensity: 0.35 }),
      )
      sac.position.set(-0.42, -0.3, 0.25)
      economics.add(sac)
    }
    if (burnPct > 0) {
      const count = Math.round(12 + burnPct * 0.7)
      const positions = new Float32Array(count * 3)
      const seeds = Array.from({ length: count }, () => ({ x: (rng() - 0.5) * 1.4, z: (rng() - 0.5) * 1.4, y: rng() * 2, v: 0.25 + rng() * 0.4 }))
      const emberGeometry = new THREE.BufferGeometry()
      emberGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const embers = new THREE.Points(emberGeometry, pointsMaterial(GLOW.orange, 0.06, 0.85))
      economics.add(embers)
      animators.push((dt) => {
        seeds.forEach((seed, index) => {
          seed.y += dt * seed.v * speed
          if (seed.y > 2) seed.y = 0
          const spread = 1 - seed.y / 2.6
          positions[index * 3] = seed.x * spread
          positions[index * 3 + 1] = 0.55 * elongation + seed.y
          positions[index * 3 + 2] = seed.z * spread
        })
        emberGeometry.attributes.position.needsUpdate = true
      })
    }
    body.add(economics)
    track('economics', economics)
  }

  /* ---------- recovery: guardian pods, deadman nucleus ---------- */

  if (genome.recovery !== 'none') {
    const recovery = new THREE.Group()
    recovery.rotation.set((family() - 0.5) * 0.8, 0, (family() - 0.5) * 0.8)
    if (genome.recovery === 'deadman') {
      const dir = new THREE.Vector3(0.75, -0.45, 0.5).normalize()
      const dormant = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 24), emissiveMaterial(GLOW.red, 0.9, { color: 0x1a1214, roughness: 0.6 }))
      dormant.position.copy(dir).multiplyScalar(1.42)
      const glow = haloSprite(GLOW.red, 0.9, 0.35)
      glow.position.copy(dormant.position)
      dormant.userData.untracked = true
      glow.userData.untracked = true
      const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([dir.clone(), dir.clone().multiplyScalar(1.42)]), glowLine(GLOW.red, 0.5))
      recovery.add(dormant, glow, tether)
      animators.push((_dt, t) => {
        const beat = Math.pow(Math.max(0, Math.sin(t * 1.4)), 12)
        ;(dormant.material as THREE.MeshStandardMaterial).emissiveIntensity = (0.6 + beat * 2.4) * energy.current
        glow.material.opacity = (0.2 + beat * 0.6) * Math.min(1, energy.current)
      })
    } else {
      const count = genome.recovery === 'multisig' ? 3 : 5
      const pod = new THREE.SphereGeometry(0.075, 24, 18)
      const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.2, emissive: GLOW.green, emissiveIntensity: 0.3 })
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * TAU
        const dir = new THREE.Vector3(Math.cos(angle), 0.15, Math.sin(angle)).normalize()
        const node = new THREE.Mesh(pod, metal)
        node.position.copy(dir).multiplyScalar(1.3)
        const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(0.98), node.position.clone()]), glowLine(GLOW.green, 0.35))
        recovery.add(node, tether)
      }
      animators.push((dt) => (recovery.rotation.y += dt * 0.15))
    }
    root.add(recovery)
    track('recovery', recovery)
  }

  /* ---------- highlight + energy ---------- */

  let highlight: OrganPart | null = null
  const energy = { current: 1, target: 1 }
  const factors = new Map<OrganPart, number>()
  const scales = new Map<OrganPart, number>()

  const applyFactors = (dt: number) => {
    const k = dt ? 1 - Math.exp(-dt * 9) : 1
    for (const [part, objects] of parts) {
      const target = highlight === null ? 1 : highlight === part ? 2.2 : 0.28
      const current = factors.get(part) ?? 1
      factors.set(part, current + (target - current) * k)
      const scaleTarget = highlight === part && part !== 'privacy' ? 1.06 : 1
      const scale = scales.get(part) ?? 1
      const nextScale = scale + (scaleTarget - scale) * k
      scales.set(part, nextScale)
      for (const object of objects) if (object !== membrane) object.scale.setScalar(nextScale)
    }
    const pulse = 0.78 + 0.22 * Math.sin(clock * 5.5)
    for (const item of tracked) {
      const alarm = alerts.get(item.part) ?? 0
      const factor = (factors.get(item.part) ?? 1) * energy.current * (1 + alarm * 0.9)
      if (item.key === 'emissiveIntensity') item.material.emissiveIntensity = item.base * factor
      else item.material.opacity = Math.min(1, item.base * Math.min(factor, 1.6))
      if (item.tint && item.baseTint) item.tint.copy(item.baseTint).lerp(ALERT, Math.min(1, alarm * pulse))
    }
  }

  /* ---------- analysis overlays: scan beam, exposure alert, lattice shell ---------- */

  let fx: OrganismFx = NO_FX
  let clock = 0
  const alerts = new Map<OrganPart, number>()
  const revealed = new Set<OrganPart>()
  let scanAt: number | null = null
  const partHeight = new Map<OrganPart, number>()

  const beam = new THREE.Group()
  beam.visible = false
  const beamRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.75, 0.006, 6, 160),
    new THREE.MeshBasicMaterial({ color: GLOW.cyan, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  )
  beamRing.rotation.x = Math.PI / 2
  const beamSheet = new THREE.Mesh(
    new THREE.CircleGeometry(1.75, 96),
    new THREE.MeshBasicMaterial({ color: GLOW.cyan, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  )
  beamSheet.rotation.x = -Math.PI / 2
  beam.add(beamRing, beamSheet)
  root.add(beam)

  const lattice = new THREE.Group()
  const shellGeometry = new THREE.IcosahedronGeometry(1.72, 1)
  const shellLines = new THREE.LineSegments(new THREE.WireframeGeometry(shellGeometry), glowLine(GLOW.lime, 0))
  const shellNodes = new THREE.Points(shellGeometry, pointsMaterial(GLOW.lime, 0.07, 0))
  const innerShell = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.OctahedronGeometry(1.5, 1)), glowLine(GLOW.cyan, 0))
  lattice.add(shellLines, shellNodes, innerShell)
  lattice.visible = false
  root.add(lattice)
  let latticeLevel = 0

  const measureParts = () => {
    root.updateMatrixWorld(true)
    const box = new THREE.Box3()
    const center = new THREE.Vector3()
    const rootInverse = root.matrixWorld.clone().invert()
    for (const [part, objects] of parts) {
      let sum = 0
      for (const object of objects) {
        box.setFromObject(object).getCenter(center)
        sum += center.applyMatrix4(rootInverse).y
      }
      partHeight.set(part, objects.length ? sum / objects.length : 0)
    }
  }

  const stepFx = (dt: number) => {
    clock += dt
    if (scanAt !== null) {
      const progress = (clock - scanAt) / SCAN_SECONDS
      const y = 1.9 - progress * 3.8
      beam.visible = progress <= 1
      beam.position.y = y
      const edge = Math.min(progress, 1 - progress) * 8
      ;(beamRing.material as THREE.MeshBasicMaterial).opacity = Math.min(1, edge)
      ;(beamSheet.material as THREE.MeshBasicMaterial).opacity = Math.min(0.1, edge * 0.1)
      for (const part of fx.exposed) if ((partHeight.get(part) ?? 0) >= y) revealed.add(part)
      if (progress > 1) {
        scanAt = null
        for (const part of fx.exposed) revealed.add(part)
      }
    }
    const k = 1 - Math.exp(-dt * 7)
    for (const part of parts.keys()) {
      const target = fx.exposed.includes(part) && revealed.has(part) ? fx.alert : 0
      const current = alerts.get(part) ?? 0
      alerts.set(part, current + (target - current) * k)
    }
    latticeLevel += (fx.lattice - latticeLevel) * (1 - Math.exp(-dt * 3))
    lattice.visible = latticeLevel > 0.01
    if (lattice.visible) {
      lattice.rotation.y += dt * 0.08
      lattice.rotation.x = Math.sin(clock * 0.3) * 0.08
      lattice.scale.setScalar(0.86 + latticeLevel * 0.14)
      ;(shellLines.material as THREE.LineBasicMaterial).opacity = latticeLevel * 0.32
      ;(shellNodes.material as THREE.PointsMaterial).opacity = latticeLevel * 0.85
      ;(innerShell.material as THREE.LineBasicMaterial).opacity = latticeLevel * 0.16
      innerShell.rotation.y -= dt * 0.14
    }
  }

  const bob = family() * TAU
  applyFactors(0)

  return {
    group: root,
    radius: 2.05,
    surface,
    update(dt, t) {
      time.value = t
      breath.value = 1
      energy.current += (energy.target - energy.current) * (1 - Math.exp(-dt * 5))
      for (const animate of animators) animate(dt, t)
      body.rotation.y += dt * 0.12
      root.position.y = Math.sin(t * 0.8 + bob) * 0.05
      stepFx(dt)
      applyFactors(dt)
    },
    setHighlight(part) {
      highlight = part
    },
    setEnergy(value) {
      energy.target = value
    },
    setFx(next, immediate = false) {
      const rescan = !immediate && next.scan !== fx.scan && next.scan > 0
      fx = next
      if (rescan) {
        measureParts()
        revealed.clear()
        scanAt = clock
      } else if (scanAt === null) {
        for (const part of next.exposed) revealed.add(part)
      }
      if (immediate) {
        latticeLevel = next.lattice
        for (const part of next.exposed) alerts.set(part, next.alert)
      }
    },
    dispose() {
      disposeObject(root)
    },
  }
}
