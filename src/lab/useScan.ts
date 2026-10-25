import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type AncestorId, DEFAULT_ANCESTOR, exposedParts, MODELS } from '../protocol/ancestors'
import { usePrefersReducedMotion } from '../lib/hooks'
import type { OrganismFx } from '../three/types'

const SWEEP_MS = 1700

/** Drives the scan beam and reveals loci top to bottom as it passes. */
export function useScan(initiallyDone = false, ancestor: AncestorId = DEFAULT_ANCESTOR) {
  const loci = MODELS[ancestor].loci
  const reduced = usePrefersReducedMotion()
  const [scan, setScan] = useState(0)
  const [revealed, setRevealed] = useState(initiallyDone ? loci.length : 0)
  const [state, setState] = useState<'idle' | 'scanning' | 'done'>(initiallyDone ? 'done' : 'idle')
  const timers = useRef<number[]>([])

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), [])

  const run = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
    setScan((value) => value + 1)
    if (reduced) {
      setRevealed(loci.length)
      setState('done')
      return
    }
    setRevealed(0)
    setState('scanning')
    const step = SWEEP_MS / loci.length
    loci.forEach((_, index) => {
      timers.current.push(window.setTimeout(() => setRevealed(index + 1), step * (index + 1)))
    })
    timers.current.push(window.setTimeout(() => setState('done'), SWEEP_MS + 120))
  }, [reduced, loci])

  const reset = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
    setRevealed(0)
    setState('idle')
  }, [])

  const exposed = useMemo(() => exposedParts(ancestor), [ancestor])
  const fx: OrganismFx = { exposed, alert: state === 'idle' ? 0 : 1, lattice: 0, scan }
  return { run, reset, state, revealed, fx, scan }
}
