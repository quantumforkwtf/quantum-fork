import { useSyncExternalStore } from 'react'
import { report } from './api'

export type Engine = typeof import('../three')

let engine: Promise<Engine> | null = null

/** The three.js engine is a separate chunk, fetched the first time a 3D view mounts. */
export const loadEngine = () => (engine ??= import('../three'))

let webgl: boolean | null = null
let reported = false
const listeners = new Set<() => void>()

export function hasWebGL() {
  if (webgl === null) {
    try {
      const canvas = document.createElement('canvas')
      webgl = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
    } catch {
      webgl = false
    }
    if (!webgl) webglFailed('WebGL unavailable; rendering the 2D fallback')
  }
  return webgl
}

/** Switches every viewport to the 2D organism for the rest of the session. Reported once. */
export function webglFailed(reason: string) {
  if (!reported) {
    reported = true
    report('webgl', reason)
  }
  webgl = false
  listeners.forEach((listener) => listener())
}

export function useWebGL() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hasWebGL,
    () => false,
  )
}
