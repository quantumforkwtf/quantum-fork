import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from './hooks'

/** Steps through named stages on a timer. Reduced motion compresses every stage. */
export function useSequence<T extends string>(steps: readonly { id: T; ms: number }[], running = true) {
  const reduced = usePrefersReducedMotion()
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!running || index >= steps.length - 1) return
    const id = window.setTimeout(() => setIndex((current) => current + 1), reduced ? 120 : steps[index].ms)
    return () => window.clearTimeout(id)
  }, [index, running, steps, reduced])

  return { step: steps[index].id, index, done: index === steps.length - 1 }
}
