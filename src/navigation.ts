import { useSyncExternalStore } from 'react'

const NAVIGATE = 'qfork:navigate'

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  window.addEventListener(NAVIGATE, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(NAVIGATE, listener)
  }
}

function snapshot() {
  return window.location.pathname + window.location.search
}

export function useLocation() {
  const href = useSyncExternalStore(subscribe, snapshot, () => '/')
  const url = new URL(href, window.location.origin)
  return { path: url.pathname, query: url.searchParams }
}

export function navigate(to: string, options: { replace?: boolean; keepScroll?: boolean } = {}) {
  if (options.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.dispatchEvent(new Event(NAVIGATE))
  if (!options.keepScroll) window.scrollTo({ top: 0 })
}
