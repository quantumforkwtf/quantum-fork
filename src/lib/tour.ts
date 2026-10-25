import { useSyncExternalStore } from 'react'

export type TourTrack = 'simple' | 'technical'

const STORAGE_KEY = 'qfork.tour.v1'
const listeners = new Set<() => void>()

/** Opens on a first visit; afterwards only when replayed. */
let open = (() => {
  try {
    return !window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return false
  }
})()

function setOpen(next: boolean) {
  open = next
  listeners.forEach((listener) => listener())
}

export function replayTour() {
  setOpen(true)
}

export function finishTour(result: TourTrack | 'skipped') {
  try {
    window.localStorage.setItem(STORAGE_KEY, result)
  } catch {
    // Without storage the tour simply shows again next visit.
  }
  setOpen(false)
}

export function useTourOpen() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => open,
    () => false,
  )
}
