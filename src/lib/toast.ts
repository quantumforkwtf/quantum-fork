import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  message: string
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function toast(message: string) {
  const id = nextId++
  toasts = [...toasts.slice(-2), { id, message }]
  emit()
  window.setTimeout(() => {
    toasts = toasts.filter((item) => item.id !== id)
    emit()
  }, 2600)
}

export function useToasts() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => toasts,
    () => toasts,
  )
}

export async function copyText(text: string, message = 'Copied to clipboard.') {
  try {
    await navigator.clipboard.writeText(text)
    toast(message)
  } catch {
    toast('Clipboard unavailable.')
  }
}
