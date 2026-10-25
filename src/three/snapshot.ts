import * as THREE from 'three'
import type { ChainGenome } from '../lab/genome'
import { fingerprint } from '../lab/genome'
import { addStudioLights, environmentFor } from './core'
import { buildMotif } from './motifs'
import { buildOrganism } from './organism'
import type { MotifKind, OrganismFx } from './types'

/**
 * Thumbnails share one offscreen renderer so a grid of specimens never needs
 * more than a single WebGL context.
 */

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
const cache = new Map<string, string>()
const queue: { key: string; draw: () => string; resolve: (url: string) => void; reject: (error: unknown) => void }[] = []
let running = false

function setup() {
  if (renderer) return
  const canvas = document.createElement('canvas')
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  scene = new THREE.Scene()
  scene.environment = environmentFor(renderer)
  scene.environmentIntensity = 0.6
  addStudioLights(scene)
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
}

function pump() {
  if (running) return
  const job = queue.shift()
  if (!job) return
  running = true
  const run = () => {
    try {
      const hit = cache.get(job.key)
      const url = hit ?? job.draw()
      cache.set(job.key, url)
      job.resolve(url)
    } catch (error) {
      job.reject(error)
    }
    running = false
    pump()
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 120 })
  else setTimeout(run, 0)
}

function enqueue(key: string, draw: () => string) {
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  return new Promise<string>((resolve, reject) => {
    queue.push({ key, draw, resolve, reject })
    pump()
  })
}

function capture(object: THREE.Object3D, size: number, distance: number, after?: () => void) {
  setup()
  renderer!.setSize(size, size, false)
  camera!.position.set(0, 0.25, distance)
  camera!.lookAt(0, 0, 0)
  scene!.add(object)
  renderer!.render(scene!, camera!)
  const url = renderer!.domElement.toDataURL('image/png')
  scene!.remove(object)
  after?.()
  return url
}

export function renderOrganismSnapshot(genome: ChainGenome, size = 320) {
  const pixels = Math.round(size * Math.min(2, window.devicePixelRatio || 1))
  const key = `org:${fingerprint(genome)}:${pixels}`
  return enqueue(key, () => {
    const organism = buildOrganism(genome, { detail: 'low' })
    organism.setEnergy(1.25)
    organism.update(0.016, 1.2)
    organism.group.rotation.set(0.12, 0.5, 0)
    return capture(organism.group, pixels, 2.15 / Math.sin(THREE.MathUtils.degToRad(15)), () => organism.dispose())
  })
}

/** An organism with its blueprint motif, framed wider so the motif fits. */
export function renderBlueprintSnapshot(genome: ChainGenome, motif: MotifKind, fx: OrganismFx, size = 360) {
  const pixels = Math.round(size * Math.min(2, window.devicePixelRatio || 1))
  const key = `bp:${motif}:${fingerprint(genome)}:${fx.exposed.join('.')}:${fx.lattice}:${pixels}`
  return enqueue(key, () => {
    const group = new THREE.Group()
    const organism = buildOrganism(genome, { detail: 'low' })
    organism.setFx(fx, true)
    organism.setEnergy(1.2)
    organism.update(0.016, 1.2)
    const structure = buildMotif(motif)
    structure.setActivity(0.7, true)
    structure.setPresence(1, true)
    structure.update(0.016, 1.2)
    group.add(organism.group, structure.group)
    group.rotation.set(0.16, 0.5, 0)
    return capture(group, pixels, 3.05 / Math.sin(THREE.MathUtils.degToRad(15)), () => {
      organism.dispose()
      structure.dispose()
    })
  })
}
