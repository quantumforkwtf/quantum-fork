import * as THREE from 'three'
import type { ReactorPhase } from '../lab/protocol'
import { addStudioLights, damp, dot, GLOW, haloSprite, reducedMotion, Stage, trackPointer } from './core'
import { buildMotif, type MotifHandle } from './motifs'
import { buildOrganism, type OrganismHandle } from './organism'
import { type MotifKind, NO_FX, type OrganismFx, type ReactorController, type ReactorOptions } from './types'

const TAU = Math.PI * 2
/** Motifs are sized for the specimen view; this keeps them inside the gyroscope rings. */
const MOTIF_SCALE = 0.86

const PHASE_SECONDS: Record<ReactorPhase, number> = {
  idle: 1,
  intake: 0.9,
  sealing: 0.7,
  charging: 1.3,
  disintegrating: 0.85,
  assembling: 1.5,
  complete: 1,
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

const coreVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  void main() {
    vPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`

const coreFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  float wave(vec3 p) {
    return sin(p.x * 3.1 + uTime * 1.7) * sin(p.y * 2.7 - uTime * 1.3) * sin(p.z * 3.4 + uTime * 0.9);
  }
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.4);
    float t = wave(vPos * 2.4) + 0.5 * wave(vPos * 5.3 + 3.0) + 0.25 * wave(vPos * 9.1 - 1.0);
    float m = smoothstep(-0.7, 1.1, t);
    vec3 color = mix(uColorA, uColorB, m) * (0.45 + 1.1 * m) + uColorB * rim * 1.8;
    gl_FragColor = vec4(color * uIntensity, 1.0);
  }
`

export function mountReactor(canvas: HTMLCanvasElement, options: ReactorOptions): ReactorController {
  const reduced = reducedMotion()
  const stage = new Stage(canvas, { bloom: { strength: 0.8, radius: 0.7, threshold: 0.62 }, fov: 28 })
  const { scene, camera } = stage
  addStudioLights(scene, [GLOW.cyan, GLOW.orange])
  const pointer = trackPointer(canvas)

  let framing = options.framing ?? 'center'
  const compact = Boolean(options.compact)
  const lookAt = new THREE.Vector3(0, compact ? 0.35 : 0.5, 0)
  const baseCamera = new THREE.Vector3(0, 1.1, compact ? 13.2 : 14.6)

  const fit = (w: number, h: number) => {
    const aspect = w / h
    const needHalfHeight = compact ? 4.4 : 4.7
    const needHalfWidth = 3.7
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const byHeight = needHalfHeight / tan
    const byWidth = needHalfWidth / (tan * aspect)
    const aside = framing === 'right' && aspect > 1.25
    baseCamera.z = Math.max(byHeight, byWidth) * (compact ? 0.92 : aside ? 1.4 : 1)
    stage.offsetX = aside ? 0.23 : 0
    stage.applyOffset()
  }
  stage.onResize(fit)

  /* ---------- containment frame ---------- */

  const steel = new THREE.MeshStandardMaterial({ color: 0x1b1f24, metalness: 0.95, roughness: 0.32 })
  const brushed = new THREE.MeshStandardMaterial({ color: 0x5c636d, metalness: 1, roughness: 0.22 })
  const frame = new THREE.Group()
  scene.add(frame)

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 3.05, 0.42, 96), steel)
  pedestal.position.y = -3.05
  const pedestalLip = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.035, 8, 160), brushed)
  pedestalLip.rotation.x = Math.PI / 2
  pedestalLip.position.y = -2.83
  const pedestalGlow = new THREE.Mesh(
    new THREE.TorusGeometry(2.35, 0.008, 6, 200),
    new THREE.MeshBasicMaterial({ color: GLOW.lime, transparent: true, opacity: 0.7, toneMapped: false }),
  )
  pedestalGlow.rotation.x = Math.PI / 2
  pedestalGlow.position.y = -2.83
  frame.add(pedestal, pedestalLip, pedestalGlow)

  const lightCount = 40
  const lights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 0.03, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    lightCount,
  )
  {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (let index = 0; index < lightCount; index += 1) {
      const angle = (index / lightCount) * TAU
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle)
      m.compose(new THREE.Vector3(Math.cos(angle) * 2.86, -2.82, Math.sin(angle) * 2.86), q, new THREE.Vector3(1, 1, 1))
      lights.setMatrixAt(index, m)
      lights.setColorAt(index, new THREE.Color(0x111111))
    }
  }
  frame.add(lights)

  const crown = new THREE.Mesh(new THREE.TorusGeometry(2.95, 0.045, 10, 180), brushed)
  crown.rotation.x = Math.PI / 2
  crown.position.y = 3.15
  frame.add(crown)
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * TAU + Math.PI / 6
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 6.1, 12), brushed)
    strut.position.set(Math.cos(angle) * 2.95, 0.1, Math.sin(angle) * 2.95)
    const filament = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 5.6, 6),
      new THREE.MeshBasicMaterial({ color: GLOW.cyan, transparent: true, opacity: 0.35, toneMapped: false }),
    )
    filament.position.set(Math.cos(angle) * 2.9, 0.1, Math.sin(angle) * 2.9)
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.0, 8), brushed)
    spoke.rotation.z = Math.PI / 2
    spoke.position.set(Math.cos(angle) * 1.95, 3.15, Math.sin(angle) * 1.95)
    spoke.lookAt(0, 3.15, 0)
    spoke.rotateY(Math.PI / 2)
    frame.add(strut, filament, spoke)
  }
  const electrode = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 12, 96), steel)
  electrode.rotation.x = Math.PI / 2
  electrode.position.y = 3.15
  const electrodeGlow = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.012, 6, 120),
    new THREE.MeshBasicMaterial({ color: GLOW.lime, transparent: true, opacity: 0.8, toneMapped: false }),
  )
  electrodeGlow.rotation.x = Math.PI / 2
  electrodeGlow.position.y = 3.07
  frame.add(electrode, electrodeGlow)

  /* ---------- gyroscope rings ---------- */

  const ringDefs = [
    { radius: 2.36, color: GLOW.lime, axis: new THREE.Euler(0.4, 0, 0.2), rate: 0.35 },
    { radius: 2.56, color: GLOW.cyan, axis: new THREE.Euler(1.2, 0.6, -0.3), rate: -0.28 },
    { radius: 2.76, color: GLOW.orange, axis: new THREE.Euler(-0.6, 1.4, 0.5), rate: 0.22 },
  ]
  const horizontal = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))
  const rings = ringDefs.map((def, index) => {
    const holder = new THREE.Group()
    const torus = new THREE.Mesh(new THREE.TorusGeometry(def.radius, 0.032 - index * 0.004, 12, 240), steel)
    const glowLine = new THREE.Mesh(
      new THREE.TorusGeometry(def.radius, 0.006, 4, 240),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.45, toneMapped: false }),
    )
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(def.radius, 0.022, 6, 64, 0.9),
      new THREE.MeshBasicMaterial({ color: def.color, toneMapped: false }),
    )
    const arcB = arc.clone()
    arcB.rotation.z = Math.PI
    const spinner = new THREE.Group()
    spinner.add(torus, glowLine, arc, arcB)
    holder.add(spinner)
    holder.quaternion.setFromEuler(def.axis)
    scene.add(holder)
    return { holder, spinner, def, free: new THREE.Quaternion().setFromEuler(def.axis), spin: index, glow: glowLine.material as THREE.MeshBasicMaterial }
  })

  /* ---------- plasma core ---------- */

  const coreUniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uColorA: { value: new THREE.Color(0x0d3a48) },
    uColorB: { value: new THREE.Color(0x9ff4ff) },
  }
  const electrodeMaterial = electrodeGlow.material as THREE.MeshBasicMaterial
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 96, 64),
    new THREE.ShaderMaterial({ uniforms: coreUniforms, vertexShader: coreVertex, fragmentShader: coreFragment, toneMapped: false }),
  )
  const coreHalo = haloSprite(GLOW.cyan, 4.2, 0.55)
  const coreGroup = new THREE.Group()
  coreGroup.add(core, coreHalo)
  scene.add(coreGroup)

  /* ---------- arcs ---------- */

  const arcCount = 9
  const arcSegments = 14
  const arcPositions = new Float32Array(arcCount * arcSegments * 2 * 3)
  const arcGeometry = new THREE.BufferGeometry()
  arcGeometry.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3))
  const arcMaterial = new THREE.LineBasicMaterial({ color: 0xe9ffc2, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const arcs = new THREE.LineSegments(arcGeometry, arcMaterial)
  scene.add(arcs)
  let arcClock = 0
  const regenerateArcs = () => {
    const start = new THREE.Vector3()
    const end = new THREE.Vector3()
    const point = new THREE.Vector3()
    const prev = new THREE.Vector3()
    let offset = 0
    for (let a = 0; a < arcCount; a += 1) {
      const angle = Math.random() * TAU
      start.set(Math.cos(angle), (Math.random() - 0.5) * 1.2, Math.sin(angle)).normalize().multiplyScalar(0.6)
      const target = rings[a % 3].def.radius
      const theta = angle + (Math.random() - 0.5) * 0.8
      end.set(Math.cos(theta) * target, (Math.random() - 0.5) * 2.2, Math.sin(theta) * target)
      prev.copy(start)
      for (let s = 1; s <= arcSegments; s += 1) {
        const f = s / arcSegments
        point.lerpVectors(start, end, f)
        const jitter = Math.sin(f * Math.PI) * 0.28
        point.x += (Math.random() - 0.5) * jitter
        point.y += (Math.random() - 0.5) * jitter
        point.z += (Math.random() - 0.5) * jitter
        arcPositions.set([prev.x, prev.y, prev.z, point.x, point.y, point.z], offset)
        offset += 6
        prev.copy(point)
      }
    }
    arcGeometry.attributes.position.needsUpdate = true
  }

  /* ---------- particles: burst + assembly ---------- */

  const particleCount = 1400
  const pPos = new Float32Array(particleCount * 3)
  const pVel = new Float32Array(particleCount * 3)
  const pFrom = new Float32Array(particleCount * 3)
  const particleGeometry = new THREE.BufferGeometry()
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  const particleMaterial = new THREE.PointsMaterial({ color: 0xe8ffd0, size: 0.06, map: dot(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const particles = new THREE.Points(particleGeometry, particleMaterial)
  particles.frustumCulled = false
  scene.add(particles)

  const burst = () => {
    for (let index = 0; index < particleCount; index += 1) {
      const theta = Math.random() * TAU
      const z = Math.random() * 2 - 1
      const r = Math.sqrt(1 - z * z)
      const x = r * Math.cos(theta)
      const y = z
      const w = r * Math.sin(theta)
      const speed = 2.2 + Math.random() * 4.2
      pPos.set([x * 0.5, y * 0.5, w * 0.5], index * 3)
      pVel.set([x * speed, y * speed, w * speed], index * 3)
    }
  }

  /* ---------- ambient dust ---------- */

  const dustCount = 260
  const dustPos = new Float32Array(dustCount * 3)
  for (let index = 0; index < dustCount; index += 1) {
    const angle = Math.random() * TAU
    const radius = 1 + Math.random() * 4.5
    dustPos.set([Math.cos(angle) * radius, -3 + Math.random() * 7, Math.sin(angle) * radius], index * 3)
  }
  const dustGeometry = new THREE.BufferGeometry()
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xbfd6ff, size: 0.028, map: dot(), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }))
  scene.add(dust)

  /* ---------- organism slot ---------- */

  let organism: OrganismHandle | null = null
  let genome = options.genome
  let hasResult = Boolean(options.showResult)
  let fx: OrganismFx = options.fx ?? NO_FX
  let dim = 0
  let dimTarget = 0
  const slot = new THREE.Group()
  scene.add(slot)
  const placeOrganism = () => {
    organism?.dispose()
    if (organism) slot.remove(organism.group)
    organism = buildOrganism(genome)
    organism.group.userData.genome = genome
    organism.setFx(fx, true)
    slot.add(organism.group)
  }
  placeOrganism()

  /* soft genome swap: fold the organism away, regrow it as the new genome */
  let swapPending = false
  let swap = 1

  /* blueprint motifs, crossfaded inside the same scene */
  const motifHolder = new THREE.Group()
  scene.add(motifHolder)
  const motifs: MotifHandle[] = []
  let motifKind: MotifKind | null = null
  const motifActivity = options.activity ?? 0.7
  const setMotif = (kind: MotifKind | null, immediate: boolean) => {
    if (kind === motifKind) return
    motifKind = kind
    for (const motif of motifs) motif.setPresence(0, immediate)
    if (kind) {
      const motif = buildMotif(kind)
      motif.setActivity(motifActivity, true)
      motif.setPresence(0, true)
      motif.setPresence(1, immediate)
      motifHolder.add(motif.group)
      motifs.push(motif)
    }
    stage.invalidate()
  }
  setMotif(options.motif ?? null, true)

  /* ---------- phase state ---------- */

  let phase: ReactorPhase = options.phase ?? 'idle'
  let phaseStart = 0
  let now = 0
  const state = { core: 1, coreScale: 1, bloom: 0.8, spin: 0.35, align: 0, organism: hasResult ? 1 : 0, arcs: 0, lights: 0.2, flash: 0 }

  const enter = (next: ReactorPhase) => {
    if (next === 'disintegrating' && phase !== 'disintegrating') burst()
    if (next === 'assembling' && phase !== 'assembling') {
      pFrom.set(pPos)
      if (organism?.group.userData.genome !== genome) placeOrganism()
    }
    if (next === 'intake') hasResult = false
    if (next === 'complete') hasResult = true
    phase = next
    phaseStart = now
    stage.invalidate()
  }

  stage.onFrame((dt, t) => {
    now = t
    pointer.step(dt)
    const elapsed = t - phaseStart
    const progress = reduced ? 1 : clamp01(elapsed / PHASE_SECONDS[phase])
    coreUniforms.uTime.value = t

    let coreTarget = 1
    let coreScaleTarget = hasResult ? 0 : 1
    let bloomTarget = 0.8
    let spinTarget = 0.35
    let alignTarget = 0
    let organismTarget = hasResult ? 1 : 0
    let lightsTarget = 0.25
    let arcTarget = 0
    let electrodeTarget = 0.8

    switch (phase) {
      case 'idle':
        break
      case 'intake':
        electrodeTarget = 1 + Math.sin(progress * Math.PI) * 1.6
        coreTarget = 1.4
        lightsTarget = 0.5
        coreScaleTarget = 1
        organismTarget = 0
        break
      case 'sealing':
        alignTarget = 1
        spinTarget = 1.2
        coreTarget = 1.8
        bloomTarget = 1
        lightsTarget = 0.8
        coreScaleTarget = 1
        organismTarget = 0
        break
      case 'charging':
        alignTarget = 1
        spinTarget = 5.5
        coreTarget = 2.6 + Math.sin(t * 40) * 0.35 + Math.random() * 0.3
        bloomTarget = 1.55
        lightsTarget = 1
        arcTarget = 1
        coreScaleTarget = 1.08
        organismTarget = 0
        break
      case 'disintegrating':
        alignTarget = 1
        spinTarget = 3
        coreTarget = 5 * (1 - progress) + 0.5
        coreScaleTarget = 1 - progress
        bloomTarget = 2.1 - progress * 0.8
        lightsTarget = 1
        arcTarget = 1 - progress
        organismTarget = 0
        break
      case 'assembling':
        alignTarget = 1 - progress * 0.6
        spinTarget = 1.6
        coreScaleTarget = 0
        coreTarget = 0.4
        bloomTarget = 1.15
        lightsTarget = 0.9
        organismTarget = ease(progress)
        break
      case 'complete':
        spinTarget = 0.35
        organismTarget = 1
        coreScaleTarget = 0
        bloomTarget = 0.85
        lightsTarget = 0.45
        break
    }

    electrodeMaterial.opacity = damp(electrodeMaterial.opacity, Math.min(1, electrodeTarget), 10, dt)
    electrodeGlow.scale.setScalar(damp(electrodeGlow.scale.x, electrodeTarget > 1 ? 1 + (electrodeTarget - 1) * 0.06 : 1, 10, dt))

    const lambda = reduced ? 100 : 6
    state.core = damp(state.core, coreTarget, 12, dt)
    state.coreScale = damp(state.coreScale, coreScaleTarget, lambda, dt)
    state.bloom = damp(state.bloom, bloomTarget, 5, dt)
    state.spin = damp(state.spin, spinTarget, 3, dt)
    state.align = damp(state.align, alignTarget, lambda * 0.7, dt)
    state.organism = phase === 'assembling' ? organismTarget : damp(state.organism, organismTarget, lambda, dt)
    state.lights = damp(state.lights, lightsTarget, 6, dt)
    state.arcs = damp(state.arcs, arcTarget, 14, dt)

    coreUniforms.uIntensity.value = state.core
    const charged = phase === 'charging' || phase === 'disintegrating'
    coreUniforms.uColorB.value.setHex(charged ? 0xeaffc4 : phase === 'sealing' ? 0xd2ffe6 : 0x9ff4ff)
    coreUniforms.uColorA.value.setHex(charged ? 0x3b7a12 : 0x0d3a48)
    coreGroup.scale.setScalar(Math.max(0.0001, state.coreScale))
    coreGroup.visible = state.coreScale > 0.01
    coreHalo.material.opacity = 0.35 + state.core * 0.12
    coreHalo.material.color.setHex(charged ? GLOW.lime : GLOW.cyan)
    dim = damp(dim, dimTarget, reduced ? 100 : 2.4, dt)
    if (stage.bloom) stage.bloom.strength = state.bloom * (1 - dim * 0.35)
    stage.renderer.toneMappingExposure = 1 - dim * 0.55

    rings.forEach((ring, index) => {
      ring.spin += dt * state.spin * (index % 2 ? -1 : 1) * (1 + index * 0.2)
      ring.free.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dt * ring.def.rate * 0.4))
      ring.holder.quaternion.slerpQuaternions(ring.free, horizontal, ease(clamp01(state.align)))
      ring.spinner.rotation.z = ring.spin
      ring.glow.opacity = 0.3 + state.lights * 0.5
    })

    arcClock += dt
    if (state.arcs > 0.02 && arcClock > 0.06) {
      arcClock = 0
      regenerateArcs()
    }
    arcMaterial.opacity = state.arcs * (0.55 + Math.random() * 0.45)
    arcs.visible = state.arcs > 0.02

    const color = new THREE.Color()
    for (let index = 0; index < lightCount; index += 1) {
      const chase = (Math.sin(t * 6 - (index / lightCount) * TAU * 2) + 1) / 2
      const level = phase === 'complete' ? state.lights : state.lights * (0.35 + chase * 0.65)
      color.setHex(phase === 'complete' || phase === 'idle' ? GLOW.green : charged ? GLOW.lime : GLOW.yellow).multiplyScalar(0.08 + level * 2.2)
      lights.setColorAt(index, color)
    }
    lights.instanceColor!.needsUpdate = true

    if (phase === 'disintegrating') {
      const drag = Math.exp(-dt * 1.6)
      for (let index = 0; index < particleCount * 3; index += 1) {
        pPos[index] += pVel[index] * dt
        pVel[index] *= drag
      }
      particleMaterial.opacity = 0.95
      particleGeometry.attributes.position.needsUpdate = true
    } else if (phase === 'assembling' && organism) {
      const k = ease(progress)
      const surface = organism.surface
      const count = surface.length / 3
      for (let index = 0; index < particleCount; index += 1) {
        const s = (index % count) * 3
        const i3 = index * 3
        pPos[i3] = pFrom[i3] + (surface[s] - pFrom[i3]) * k
        pPos[i3 + 1] = pFrom[i3 + 1] + (surface[s + 1] - pFrom[i3 + 1]) * k
        pPos[i3 + 2] = pFrom[i3 + 2] + (surface[s + 2] - pFrom[i3 + 2]) * k
      }
      particleMaterial.opacity = 0.95 * (1 - k * k)
      particleGeometry.attributes.position.needsUpdate = true
    } else {
      particleMaterial.opacity = damp(particleMaterial.opacity, 0, 8, dt)
    }
    particles.visible = particleMaterial.opacity > 0.01

    for (let index = 0; index < dustCount; index += 1) {
      dustPos[index * 3 + 1] += dt * (0.08 + (index % 7) * 0.012) * (charged ? 4 : 1)
      if (dustPos[index * 3 + 1] > 4) dustPos[index * 3 + 1] = -3
    }
    dustGeometry.attributes.position.needsUpdate = true

    if (swapPending) {
      swap = damp(swap, 0, 11, dt)
      if (swap < 0.04) {
        swapPending = false
        placeOrganism()
      }
    } else {
      swap = damp(swap, 1, 4.2, dt)
    }

    if (organism) {
      const s = Math.max(0.0001, state.organism * swap)
      slot.scale.setScalar(s)
      slot.visible = s > 0.01
      organism.setEnergy(phase === 'assembling' ? 2.6 - progress * 1.75 : 0.85 + (1 - swap) * 1.8)
      organism.update(dt, t)
    }

    motifHolder.scale.setScalar(Math.max(0.0001, state.organism) * MOTIF_SCALE)
    motifHolder.visible = state.organism > 0.01
    motifHolder.rotation.y = pointer.state.x * 0.12
    for (let index = motifs.length - 1; index >= 0; index -= 1) {
      const motif = motifs[index]
      motif.update(dt, t)
      if (motif.presenceTarget === 0 && motif.presence < 0.01) {
        motifHolder.remove(motif.group)
        motif.dispose()
        motifs.splice(index, 1)
      }
    }

    const shake = phase === 'charging' && !reduced ? 0.025 : 0
    camera.position.set(
      baseCamera.x + pointer.state.x * 0.9 + (Math.random() - 0.5) * shake,
      baseCamera.y - pointer.state.y * 0.5 + (Math.random() - 0.5) * shake,
      baseCamera.z,
    )
    camera.lookAt(lookAt)
    frame.rotation.y = pointer.state.x * 0.05
  })

  stage.start()
  if (phase !== 'idle') enter(phase)

  return {
    setPhase(next) {
      if (next !== phase) enter(next)
    },
    setGenome(next, { soft = false } = {}) {
      genome = next
      if (phase === 'idle' || phase === 'complete') {
        if (soft && !reduced && organism) swapPending = true
        else placeOrganism()
      }
      stage.invalidate()
    },
    setMotif(kind) {
      setMotif(kind, reduced)
    },
    setFraming(next) {
      framing = next
      fit(stage.width, stage.height)
      stage.invalidate()
    },
    setFx(next) {
      fx = next
      organism?.setFx(next, reduced)
      stage.invalidate()
    },
    setDim(amount) {
      dimTarget = amount
      stage.invalidate()
    },
    dispose() {
      pointer.dispose()
      organism?.dispose()
      for (const motif of motifs) motif.dispose()
      stage.dispose()
    },
  }
}
