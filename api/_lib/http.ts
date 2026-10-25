import { type ZodType } from 'zod'
import { serverEnv, type ServerEnv } from './env.js'
import { createLogger, type Logger } from './log.js'
import { getStore, keys, type Store, StoreError } from './store.js'

export const MAX_BODY_BYTES = 16 * 1024

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export interface Context {
  request: Request
  url: URL
  env: ServerEnv
  store: Store
  log: Logger
  correlationId: string
  ip: string
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, ...extra } })
}

function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  return (forwarded?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'unknown').trim().slice(0, 64)
}

function newId() {
  return crypto.randomUUID()
}

export function randomToken(bytes = 10) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Rejects cross-site browser requests. Non-browser clients send no Origin and are rate-limited instead. */
function checkOrigin(context: Context) {
  const origin = context.request.headers.get('origin')
  if (!origin) return
  if (context.env.allowedOrigins.has(origin)) return
  if (context.env.dev && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return
  throw new HttpError(403, 'ORIGIN_REJECTED', 'This origin is not allowed to call the Quantum Fork API.')
}

export async function readJson<T>(context: Context, schema: ZodType<T>): Promise<T> {
  const type = context.request.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send application/json.')
  const length = Number(context.request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.')
  const text = await context.request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON.')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request failed validation.', {
      issues: parsed.error.issues.slice(0, 10).map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  return parsed.data
}

/** Fixed-window limiter. Fails open on store errors so an outage does not block reads. */
export async function rateLimit(context: Context, bucket: string, limit: number, windowSeconds = 60) {
  const window = Math.floor(Date.now() / 1000 / windowSeconds)
  const key = keys.rate(bucket, context.ip, window)
  try {
    const count = await context.store.incr(key)
    if (count === 1) await context.store.expire(key, windowSeconds + 5)
    if (count > limit) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.', { retryAfterSeconds: windowSeconds })
  } catch (error) {
    if (error instanceof HttpError) throw error
    context.log.warn('rate limiter unavailable', { bucket })
  }
}

type Handler = (context: Context) => Promise<Response>

export function route(name: string, handlers: { GET?: Handler; POST?: Handler }, options: { checkOrigin?: boolean } = {}) {
  const run = async (request: Request, handler: Handler | undefined) => {
    const env = serverEnv()
    const correlationId = request.headers.get('x-correlation-id')?.match(/^[a-zA-Z0-9-]{8,64}$/)?.[0] ?? newId()
    const log = createLogger({ route: name, method: request.method, correlationId }, env.logLevel)
    const context: Context = { request, url: new URL(request.url), env, store: getStore(env.kv), log, correlationId, ip: clientIp(request) }
    const started = Date.now()
    try {
      if (!handler) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
      if (request.method !== 'GET' && options.checkOrigin !== false) checkOrigin(context)
      const response = await handler(context)
      response.headers.set('X-Correlation-Id', correlationId)
      log.info('request complete', { status: response.status, ms: Date.now() - started })
      return response
    } catch (error) {
      if (error instanceof HttpError) {
        log.warn('request rejected', { status: error.status, code: error.code, ms: Date.now() - started })
        return json({ error: { code: error.code, message: error.message, ...error.details }, correlationId }, error.status, { 'X-Correlation-Id': correlationId })
      }
      if (error instanceof StoreError) {
        log.error('store unavailable', { message: error.message })
        return json({ error: { code: 'STORE_UNAVAILABLE', message: 'Protocol storage is temporarily unavailable. Nothing was changed.' }, correlationId }, 503)
      }
      log.error('unhandled error', { message: error instanceof Error ? error.message : String(error) })
      return json({ error: { code: 'INTERNAL', message: 'The server failed to complete the request. Nothing was changed.' }, correlationId }, 500)
    }
  }
  return {
    GET: (request: Request) => run(request, handlers.GET),
    POST: (request: Request) => run(request, handlers.POST),
  }
}
