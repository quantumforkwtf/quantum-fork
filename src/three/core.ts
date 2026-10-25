import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

export const STAGE_BG = '#060708'

export const GLOW = {
  lime: 0xc8ff4d,
  green: 0x3dffa0,
  cyan: 0x4fe3ff,
  purple: 0x9d7bff,
  orange: 0xff7a3c,
  yellow: 0xffd54a,
  red: 0xff4d5e,
  pink: 0xff5fa8,
  white: 0xf2f0ea,
  gold: 0xffc35a,
} as const

const TAU = Math.PI * 2

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- shared textures (never disposed) ---------- */

let haloTexture: THREE.Texture | null = null
let dotTexture: THREE.Texture | null = null

function radialTexture(stops: [number, string][], size = 128) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [at, color] of stops) gradient.addColorStop(at, color)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.userData.shared = true
  return texture
}

export function halo() {
  haloTexture ??= radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.18, 'rgba(255,255,255,0.55)'],
    [0.45, 'rgba(255,255,255,0.12)'],
    [1, 'rgba(255,255,255,0)'],
  ])
  return haloTexture
}

export function dot() {
  dotTexture ??= radialTexture(
    [
      [0, 'rgba(255,255,255,1)'],
      [0.4, 'rgba(255,255,255,0.9)'],
      [1, 'rgba(255,255,255,0)'],
    ],
    64,
  )
  return dotTexture
}

export function haloSprite(color: number, scale: number, opacity = 0.6) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: halo(),
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  sprite.scale.setScalar(scale)
  return sprite
}

/* ---------- smooth seeded field ---------- */

export function makeField(rng: () => number, terms = 6, frequency = 1.6) {
  const waves = Array.from({ length: terms }, () => {
    const theta = rng() * TAU
    const phi = Math.acos(2 * rng() - 1)
    return {
      x: Math.sin(phi) * Math.cos(theta),
      y: Math.cos(phi),
      z: Math.sin(phi) * Math.sin(theta),
      k: frequency * (0.6 + rng() * 0.9),
      phase: rng() * TAU,
      amp: (0.5 + rng() * 0.5) / terms,
    }
  })
  return (x: number, y: number, z: number) => {
    let sum = 0
    for (const w of waves) sum += w.amp * Math.sin(w.k * (w.x * x + w.y * y + w.z * z) + w.phase)
    return sum * 2
  }
}

export function randomUnit(rng: () => number, target = new THREE.Vector3()) {
  const theta = rng() * TAU
  const z = 2 * rng() - 1
  const r = Math.sqrt(1 - z * z)
  return target.set(r * Math.cos(theta), z, r * Math.sin(theta))
}

/* ---------- environment ---------- */

const environments = new WeakMap<THREE.WebGLRenderer, THREE.Texture>()

export function environmentFor(renderer: THREE.WebGLRenderer) {
  let texture = environments.get(renderer)
  if (!texture) {
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    texture = pmrem.fromScene(room, 0.04).texture
    room.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      ;(mesh.material as THREE.Material | undefined)?.dispose?.()
    })
    pmrem.dispose()
    environments.set(renderer, texture)
  }
  return texture
}

export function addStudioLights(scene: THREE.Scene, rims: [number, number] = [GLOW.cyan, GLOW.lime]) {
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(3, 5, 6)
  const rimA = new THREE.PointLight(rims[0], 28, 18, 2)
  rimA.position.set(-5, 2.5, -3)
  const rimB = new THREE.PointLight(rims[1], 18, 18, 2)
  rimB.position.set(5, -2, -2.5)
  const fill = new THREE.AmbientLight(0x8890a0, 0.25)
  scene.add(key, rimA, rimB, fill)
  return { key, rimA, rimB }
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !value.userData.shared) value.dispose()
      }
      material.dispose()
    }
  })
}

/* ---------- stage: renderer + loop + resize + visibility ---------- */

export interface StageOptions {
  bloom?: { strength: number; radius: number; threshold: number }
  fov?: number
  maxDpr?: number
  exposure?: number
}

type FrameHandler = (dt: number, t: number) => void

export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly bloom: UnrealBloomPass | null = null
  width = 1
  height = 1
  /** Shift the subject horizontally, as a fraction of the canvas width. */
  offsetX = 0
  private composer: EffectComposer | null = null
  private handlers = new Set<FrameHandler>()
  private resizeHandlers = new Set<(w: number, h: number) => void>()
  private raf = 0
  private last = 0
  private time = 0
  private inView = true
  private disposed = false
  private readonly reduced = reducedMotion()
  private readonly resizeObserver: ResizeObserver
  private readonly intersection: IntersectionObserver

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: StageOptions = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxDpr ?? 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = options.exposure ?? 1
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.scene.background = new THREE.Color(STAGE_BG)
    this.scene.environment = environmentFor(this.renderer)
    this.scene.environmentIntensity = 0.55
    this.camera = new THREE.PerspectiveCamera(options.fov ?? 30, 1, 0.1, 100)

    if (options.bloom) {
      this.composer = new EffectComposer(this.renderer)
      this.composer.addPass(new RenderPass(this.scene, this.camera))
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), options.bloom.strength, options.bloom.radius, options.bloom.threshold)
      this.composer.addPass(this.bloom)
      this.composer.addPass(new OutputPass())
    }

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.intersection = new IntersectionObserver(([entry]) => {
      this.inView = entry.isIntersecting
      if (this.inView) this.kick()
    }, { rootMargin: '80px' })
    this.intersection.observe(canvas)
    document.addEventListener('visibilitychange', this.kick)
    this.resize()
  }

  onFrame(handler: FrameHandler) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  onResize(handler: (w: number, h: number) => void) {
    this.resizeHandlers.add(handler)
    handler(this.width, this.height)
    return () => this.resizeHandlers.delete(handler)
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.renderer.setSize(w, h, false)
    this.composer?.setPixelRatio(this.renderer.getPixelRatio())
    this.composer?.setSize(w, h)
    this.camera.aspect = w / h
    this.applyOffset()
    for (const handler of this.resizeHandlers) handler(w, h)
    this.renderOnce()
  }

  applyOffset() {
    if (this.offsetX) this.camera.setViewOffset(this.width, this.height, -this.offsetX * this.width, 0, this.width, this.height)
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
  }

  /** Begin the loop. With reduced motion we render a single settled frame per change. */
  start() {
    this.last = performance.now()
    this.kick()
  }

  /** Request at least one frame (used after state changes when the loop is idle). */
  invalidate() {
    if (this.reduced) this.renderOnce(0.016)
    else this.kick()
  }

  private kick = () => {
    if (this.disposed || this.raf || this.reduced) {
      if (this.reduced) this.renderOnce(0.016)
      return
    }
    if (!this.inView || document.hidden) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    this.raf = 0
    if (this.disposed || !this.inView || document.hidden) return
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.renderOnce(dt)
    this.raf = requestAnimationFrame(this.tick)
  }

  renderOnce(dt = 0) {
    if (this.disposed) return
    this.time += dt
    for (const handler of this.handlers) handler(dt, this.time)
    if (this.composer) this.composer.render(dt)
    else this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.intersection.disconnect()
    document.removeEventListener('visibilitychange', this.kick)
    disposeObject(this.scene)
    this.composer?.dispose()
    environments.get(this.renderer)?.dispose()
    environments.delete(this.renderer)
    this.renderer.dispose()
  }
}

/* ---------- pointer helpers ---------- */

export function trackPointer(element: HTMLElement) {
  const state = { x: 0, y: 0, tx: 0, ty: 0 }
  const move = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    const rect = element.getBoundingClientRect()
    state.tx = ((event.clientX - rect.left) / rect.width - 0.5) * 2
    state.ty = ((event.clientY - rect.top) / rect.height - 0.5) * 2
  }
  const leave = () => {
    state.tx = 0
    state.ty = 0
  }
  window.addEventListener('pointermove', move, { passive: true })
  element.addEventListener('pointerleave', leave)
  return {
    state,
    step(dt: number) {
      const k = 1 - Math.exp(-dt * 4)
      state.x += (Math.max(-1, Math.min(1, state.tx)) - state.x) * k
      state.y += (Math.max(-1, Math.min(1, state.ty)) - state.y) * k
    },
    dispose() {
      window.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', leave)
    },
  }
}

export const damp = (current: number, target: number, lambda: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt))
