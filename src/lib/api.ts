export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface Options {
  method?: 'GET' | 'POST'
  body?: unknown
  idempotencyKey?: string
  timeoutMs?: number
  /** Non-2xx statuses whose JSON body is a valid result rather than an error. */
  accept?: number[]
}

export async function api<T>(path: string, options: Options = {}): Promise<{ status: number; data: T; correlationId: string | null }> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'AbortError'
    throw new ApiError(0, timeout ? 'API_TIMEOUT' : 'API_UNREACHABLE', timeout ? 'The Quantum Fork API did not respond in time.' : 'The Quantum Fork API could not be reached.')
  } finally {
    window.clearTimeout(timer)
  }
  const correlationId = response.headers.get('x-correlation-id')
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (response.ok || options.accept?.includes(response.status)) return { status: response.status, data: body as T, correlationId }
  const error = (body as { error?: { code?: string; message?: string } } | null)?.error
  throw new ApiError(response.status, error?.code ?? `HTTP_${response.status}`, error?.message ?? 'The request failed.', correlationId)
}

export function idempotencyKey() {
  return crypto.randomUUID()
}

let reports = 0
const MAX_REPORTS = 10

/** Fire-and-forget client error report, at most ten per page load. Never includes wallet data or transaction bytes. */
export function report(kind: 'error' | 'unhandledrejection' | 'webgl' | 'wallet' | 'rpc' | 'boundary', message: string, extra: { stack?: string; correlationId?: string } = {}) {
  if (reports++ >= MAX_REPORTS) return
  try {
    const body = JSON.stringify({ kind, message: message.slice(0, 500), route: window.location.pathname.slice(0, 120), stack: extra.stack?.slice(0, 2000), correlationId: extra.correlationId })
    if (navigator.sendBeacon) navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' }))
    else void fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
  } catch {
    // Reporting is best-effort.
  }
}
