import * as THREE from 'three'
import type { ChainGenome } from '../lab/genome'
import type { OrganPart } from '../lab/morphology'
import { addStudioLights, damp, dot, GLOW, haloSprite, reducedMotion, Stage, trackPointer } from './core'
import { buildLayer, buildMotif, type MotifHandle } from './motifs'
import { buildOrganism, type OrganismHandle } from './organism'
import { type LayerSpec, type MotifKind, NO_FX, type OrganismFx, type SpecimenController, type SpecimenMode, type SpecimenOptions } from './types'

const TAU = Math.PI * 2
const REBUILD_MS = 110

interface Body {
  handle: OrganismHandle
  scale: number
  target: number
}

export function mountSpecimen(canvas: HTMLCanvasElement, options: SpecimenOptions): SpecimenController {
  const stage = new Stage(canvas, { bloom: { strength: 0.6, radius: 0.55, threshold: 0.7 }, fov: 30 })
  const { scene, camera } = stage
  addStudioLights(scene)
  const pointer = trackPointer(canvas)
  const zoom = options.zoom ?? 1
  let distance = 8

  stage.onResize((w, h) => {
    const aspect = w / h
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2)
    const horizontal = Math.atan(Math.tan(vertical) * aspect)
    distance = (2.85 / Math.sin(Math.min(vertical, horizontal))) * zoom
  })

  const backGlow = haloSprite(GLOW.cyan, 9, 0.09)
  backGlow.position.z = -3
  scene.add(backGlow)

  const pivot = new THREE.Group()
  scene.add(pivot)

  let highlight = options.highlight ?? null
  let energy = 1
  let energyTarget = 1
  let mode: SpecimenMode = 'idle'
  let fx: OrganismFx = options.fx ?? NO_FX
  const bodies: Body[] = []

  const add = (genome: ChainGenome, flash: boolean) => {
    const handle = buildOrganism(genome)
    handle.setHighlight(highlight)
    handle.setFx(fx, true)
    pivot.add(handle.group)
    for (const body of bodies) body.target = 0
    bodies.push({ handle, scale: bodies.length ? 0.82 : 1, target: 1 })
    if (flash) energy = 2.6
    stage.invalidate()
  }

  let pending: ChainGenome | null = null
  let pendingFlash = false
  let lastBuild = 0
  let timer = 0
  const flush = () => {
    timer = 0
    if (!pending) return
    lastBuild = performance.now()
    add(pending, pendingFlash)
    pending = null
    pendingFlash = false
  }

  add(options.genome, false)

  /* blueprint motifs, crossfaded inside the same scene */
  const motifs: MotifHandle[] = []
  const layers = new Map<string, MotifHandle>()
  let motifKind: MotifKind | null = null
  let activity = options.activity ?? 0
  const setMotif = (kind: MotifKind | null, immediate: boolean) => {
    if (kind === motifKind) return
    motifKind = kind
    const layered = new Set(layers.values())
    for (const motif of motifs) if (!layered.has(motif)) motif.setPresence(0, immediate)
    if (kind) {
      const motif = buildMotif(kind)
      motif.setActivity(activity, true)
      motif.setPresence(0, true)
      motif.setPresence(1, immediate)
      pivot.add(motif.group)
      motifs.push(motif)
    }
    stage.invalidate()
  }
  setMotif(options.motif ?? null, true)

  /* network layers: one structure per key, added and removed as the network changes */
  const setLayers = (specs: LayerSpec[], immediate: boolean) => {
    const keep = new Set(specs.map((spec) => spec.key))
    for (const [key, handle] of layers) {
      if (keep.has(key)) continue
      handle.setPresence(0, immediate)
      layers.delete(key)
    }
    let grew = false
    for (const spec of specs) {
      const existing = layers.get(spec.key)
      if (existing) {
        existing.setActivity(spec.activity ?? 0.45, immediate)
        continue
      }
      const handle = buildLayer(spec)
      handle.setActivity(spec.activity ?? 0.45, true)
      handle.setPresence(0, true)
      handle.setPresence(1, immediate)
      pivot.add(handle.group)
      motifs.push(handle)
      layers.set(spec.key, handle)
      grew = true
    }
    if (grew && !immediate) energy = Math.max(energy, 2.1)
    stage.invalidate()
  }
  setLayers(options.layers ?? [], true)

  /* mutation charge: a ring of particles that collapses into the body */
  const chargeCount = 420
  const chargeSeeds = new Float32Array(chargeCount * 3)
  for (let index = 0; index < chargeCount; index += 1) {
    chargeSeeds.set([Math.random() * TAU, (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.5], index * 3)
  }
  const chargePositions = new Float32Array(chargeCount * 3)
  const chargeGeometry = new THREE.BufferGeometry()
  chargeGeometry.setAttribute('position', new THREE.BufferAttribute(chargePositions, 3))
  const chargeMaterial = new THREE.PointsMaterial({ color: GLOW.lime, size: 0.06, map: dot(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const charge = new THREE.Points(chargeGeometry, chargeMaterial)
  charge.frustumCulled = false
  scene.add(charge)
  let chargeTime = 0

  /* drag rotation with inertia */
  let yaw = 0.3
  let pitch = 0.12
  let velocity = 0
  let dragging = false
  let lastX = 0
  let lastY = 0
  const down = (event: PointerEvent) => {
    if (!options.interactive) return
    dragging = true
    lastX = event.clientX
    lastY = event.clientY
    canvas.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    if (!dragging) return
    const dx = event.clientX - lastX
    const dy = event.clientY - lastY
    lastX = event.clientX
    lastY = event.clientY
    yaw += dx * 0.008
    velocity = dx * 0.5
    pitch = Math.max(-0.6, Math.min(0.6, pitch + dy * 0.004))
    stage.invalidate()
  }
  const up = () => {
    dragging = false
  }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)

  const autoRotate = options.autoRotate ?? true

  stage.onFrame((dt, t) => {
    pointer.step(dt)
    if (!dragging) {
      yaw += (velocity * 0.016 + (autoRotate ? 0.12 : 0)) * dt * (mode === 'mutate' ? 6 : 1)
      velocity = damp(velocity, 0, 2.5, dt)
    }
    pivot.rotation.set(pitch + pointer.state.y * 0.12, yaw + pointer.state.x * 0.25, 0)

    energyTarget = mode === 'mutate' ? 2.2 : 1
    energy = damp(energy, energyTarget, 2.2, dt)

    for (let index = bodies.length - 1; index >= 0; index -= 1) {
      const body = bodies[index]
      body.scale = damp(body.scale, body.target, body.target ? 7 : 11, dt)
      body.handle.group.scale.setScalar(Math.max(0.0001, body.scale))
      body.handle.setEnergy(energy)
      body.handle.update(dt, t)
      if (body.target === 0 && body.scale < 0.03) {
        pivot.remove(body.handle.group)
        body.handle.dispose()
        bodies.splice(index, 1)
      }
    }

    for (let index = motifs.length - 1; index >= 0; index -= 1) {
      const motif = motifs[index]
      motif.update(dt, t)
      if (motif.presenceTarget === 0 && motif.presence < 0.01) {
        pivot.remove(motif.group)
        motif.dispose()
        motifs.splice(index, 1)
      }
    }

    if (mode === 'mutate') {
      chargeTime += dt
      const pull = (chargeTime * 0.6) % 1
      for (let index = 0; index < chargeCount; index += 1) {
        const angle = chargeSeeds[index * 3] + t * 1.4
        const height = chargeSeeds[index * 3 + 1]
        const radius = (3.2 - ((pull + chargeSeeds[index * 3 + 2]) % 1) * 1.6) * 1
        chargePositions.set([Math.cos(angle) * radius, height * 0.8, Math.sin(angle) * radius], index * 3)
      }
      chargeGeometry.attributes.position.needsUpdate = true
      chargeMaterial.opacity = damp(chargeMaterial.opacity, 0.9, 6, dt)
    } else {
      chargeMaterial.opacity = damp(chargeMaterial.opacity, 0, 6, dt)
    }
    charge.visible = chargeMaterial.opacity > 0.01

    backGlow.material.opacity = 0.08 + (energy - 1) * 0.08
    if (stage.bloom) stage.bloom.strength = 0.55 + (energy - 1) * 0.5

    camera.position.set(pointer.state.x * 0.25, 0.15 - pointer.state.y * 0.15, distance)
    camera.lookAt(0, 0, 0)
  })

  stage.start()

  return {
    setGenome(genome, opts) {
      pending = genome
      pendingFlash ||= Boolean(opts?.flash)
      if (timer) return
      const wait = Math.max(0, REBUILD_MS - (performance.now() - lastBuild))
      timer = window.setTimeout(flush, wait)
    },
    setHighlight(part: OrganPart | null) {
      highlight = part
      for (const body of bodies) body.handle.setHighlight(part)
      stage.invalidate()
    },
    setMode(next, color) {
      if (next === 'mutate' && mode !== 'mutate') chargeTime = 0
      mode = next
      if (color !== undefined) chargeMaterial.color.setHex(color)
      stage.invalidate()
    },
    setFx(next) {
      fx = next
      for (const body of bodies) if (body.target) body.handle.setFx(next, reducedMotion())
      stage.invalidate()
    },
    setMotif(kind) {
      setMotif(kind, reducedMotion())
    },
    setActivity(level) {
      activity = level
      const layered = new Set(layers.values())
      for (const motif of motifs) if (motif.presenceTarget && !layered.has(motif)) motif.setActivity(level, reducedMotion())
      stage.invalidate()
    },
    setLayers(specs) {
      setLayers(specs, reducedMotion())
    },
    dispose() {
      window.clearTimeout(timer)
      for (const motif of motifs) motif.dispose()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      pointer.dispose()
      for (const body of bodies) body.handle.dispose()
      stage.dispose()
    },
  }
}
