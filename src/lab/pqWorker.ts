import { measure, SCHEME_BY_ID, type SchemeId } from '../protocol/pqSignatures'

export type BenchRequest = { ids: SchemeId[]; budgetMs: number }
export type BenchMessage = { type: 'result'; measurement: ReturnType<typeof measure> } | { type: 'error'; id: SchemeId; message: string } | { type: 'done' }

self.onmessage = (event: MessageEvent<BenchRequest>) => {
  for (const id of event.data.ids) {
    try {
      self.postMessage({ type: 'result', measurement: measure(SCHEME_BY_ID[id], { budgetMs: event.data.budgetMs }) } satisfies BenchMessage)
    } catch (cause) {
      self.postMessage({ type: 'error', id, message: cause instanceof Error ? cause.message : 'failed' } satisfies BenchMessage)
    }
  }
  self.postMessage({ type: 'done' } satisfies BenchMessage)
}
