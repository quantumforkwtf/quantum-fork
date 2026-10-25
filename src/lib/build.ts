import { useSyncExternalStore } from 'react'
import { compileBlueprint } from '../protocol/blueprintCompiler'
import { BLUEPRINT_BY_SLUG, INTENTS } from '../protocol/blueprints'

export type Intent = (typeof INTENTS)[number]

const hrefs = new Map<string, string>()

/** Where an intent leads: straight to its blueprint's primary action, so nobody passes through a page they don't need. */
export function intentHref(intent: Intent) {
  let href = hrefs.get(intent.id)
  if (!href) {
    const blueprint = BLUEPRINT_BY_SLUG[intent.slug]
    href = compileBlueprint(blueprint).plan.action.href ?? `/blueprints/${blueprint.slug}`
    hrefs.set(intent.id, href)
  }
  return href
}

/* whether the "Start building" dialog is open */

let open = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const openBuild = () => {
  open = true
  emit()
}

export const closeBuild = () => {
  open = false
  emit()
}

export const useBuildOpen = () =>
  useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
