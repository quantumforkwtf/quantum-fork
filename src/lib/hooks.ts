import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react'

const reducedQuery = '(prefers-reduced-motion: reduce)'

function subscribeReduced(callback: () => void) {
  const media = window.matchMedia(reducedQuery)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(reducedQuery).matches,
    () => false,
  )
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (callback) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', callback)
      return () => media.removeEventListener('change', callback)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export function ageOf(iso: string, now = Date.now()) {
  const days = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000))
  if (days === 0) return 'TODAY'
  if (days < 60) return `${days} DAYS`
  return `${Math.floor(days / 30)} MONTHS`
}

export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  rootMargin = '120px',
) {
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, rootMargin])

  return inView
}

/** Latches true the first time the element scrolls into view. */
export function useSeen<T extends Element>(ref: RefObject<T | null>, rootMargin = '0px') {
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || seen) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setSeen(true)
      },
      { rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, rootMargin, seen])

  return seen
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}

export function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

export function formatNumber(value: number) {
  return Math.round(value).toLocaleString('en-US')
}
