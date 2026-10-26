/**
 * Minimal key-value store. Uses Upstash Redis over REST when configured
 * (Vercel's Redis integration sets KV_REST_API_URL / KV_REST_API_TOKEN).
 * Otherwise falls back to process memory, which is NOT persistent on
 * serverless and is reported as such so callers can refuse real-value work.
 */
export interface Store {
  persistent: boolean
  kind: 'upstash' | 'memory'
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { nx?: boolean; ttlSeconds?: number }): Promise<boolean>
  del(key: string): Promise<void>
  incr(key: string, by?: number): Promise<number>
  expire(key: string, seconds: number): Promise<void>
  lpush(key: string, value: string): Promise<void>
  lrange(key: string, start: number, stop: number): Promise<string[]>
  persist(key: string): Promise<void>
}

export class StoreError extends Error {
  readonly code = 'STORE_UNAVAILABLE'
}

function upstash(url: string, token: string): Store {
  const call = async (command: (string | number)[]) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        signal: controller.signal,
      })
      if (!response.ok) throw new StoreError(`Store responded ${response.status}`)
      const body = (await response.json()) as { result?: unknown; error?: string }
      if (body.error) throw new StoreError(body.error)
      return body.result
    } catch (error) {
      if (error instanceof StoreError) throw error
      throw new StoreError('Store request failed')
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    persistent: true,
    kind: 'upstash',
    async get(key) {
      const result = await call(['GET', key])
      return typeof result === 'string' ? result : null
    },
    async set(key, value, options = {}) {
      const command: (string | number)[] = ['SET', key, value]
      if (options.nx) command.push('NX')
      if (options.ttlSeconds) command.push('EX', options.ttlSeconds)
      return (await call(command)) === 'OK'
    },
    async del(key) {
      await call(['DEL', key])
    },
    async incr(key, by = 1) {
      return Number(await call(['INCRBY', key, by]))
    },
    async expire(key, seconds) {
      await call(['EXPIRE', key, seconds])
    },
    async lpush(key, value) {
      await call(['LPUSH', key, value])
    },
    async lrange(key, start, stop) {
      const result = await call(['LRANGE', key, start, stop])
      return Array.isArray(result) ? (result as string[]) : []
    },
    async persist(key) {
      await call(['PERSIST', key])
    },
  }
}

/** `persistent` is only ever true in tests that stand in for Redis. */
export function memoryStore(persistent = false): Store {
  const memory = new Map<string, { value: string; expires: number | null }>()
  const lists = new Map<string, string[]>()
  const live = (key: string) => {
    const entry = memory.get(key)
    if (entry && entry.expires !== null && entry.expires < Date.now()) {
      memory.delete(key)
      return undefined
    }
    return entry
  }
  return {
    persistent,
    kind: 'memory',
    async get(key) {
      return live(key)?.value ?? null
    },
    async set(key, value, options = {}) {
      if (options.nx && live(key)) return false
      memory.set(key, { value, expires: options.ttlSeconds ? Date.now() + options.ttlSeconds * 1000 : null })
      return true
    },
    async del(key) {
      memory.delete(key)
    },
    async incr(key, by = 1) {
      const next = Number(live(key)?.value ?? 0) + by
      const expires = live(key)?.expires ?? null
      memory.set(key, { value: String(next), expires })
      return next
    },
    async expire(key, seconds) {
      const entry = live(key)
      if (entry) entry.expires = Date.now() + seconds * 1000
    },
    async lpush(key, value) {
      lists.set(key, [value, ...(lists.get(key) ?? [])])
    },
    async lrange(key, start, stop) {
      const list = lists.get(key) ?? []
      return list.slice(start, stop < 0 ? undefined : stop + 1)
    },
    async persist(key) {
      const entry = live(key)
      if (entry) entry.expires = null
    },
  }
}

let cached: Store | null = null

export function getStore(kv: { url: string; token: string } | null): Store {
  if (!cached) cached = kv ? upstash(kv.url, kv.token) : memoryStore()
  return cached
}

export async function getJson<T>(store: Store, key: string): Promise<T | null> {
  const raw = await store.get(key)
  return raw ? (JSON.parse(raw) as T) : null
}

export const keys = {
  deployment: (id: string) => `qf:dep:${id}`,
  idempotency: (key: string) => `qf:idem:${key}`,
  receipt: (signature: string) => `qf:receipt:${signature}`,
  burnLock: (signature: string) => `qf:burnlock:${signature}`,
  depLock: (id: string) => `qf:deplock:${id}`,
  descendants: 'qf:descendants',
  sequence: 'qf:seq:descendant',
  /** Burn totals are per network: devnet test burns must never count toward $QFORK burned on mainnet. */
  burnedRaw: (network: string) => `qf:stats:${network}:burned_raw`,
  burnCount: (network: string) => `qf:stats:${network}:burn_count`,
  /** Whole tokens, for 18-decimal ERC-20s whose base units overflow a Redis integer. */
  burnedWhole: (network: string) => `qf:stats:${network}:burned_whole`,
  rate: (bucket: string, subject: string, window: number) => `qf:rl:${bucket}:${subject}:${window}`,
  cache: (name: string) => `qf:cache:${name}`,
  launch: (mint: string) => `qf:launch:${mint}`,
  meta: (mint: string) => `qf:meta:${mint}`,
  token: (mint: string) => `qf:token:${mint}`,
  tokensOf: (deploymentId: string) => `qf:tokens:${deploymentId}`,
  tokens: 'qf:tokens',
  faucet: (subject: string) => `qf:faucet:${subject}`,
  cosignLock: (account: string, id: string) => `qf:cosignlock:${account}:${id}`,
  cosignDaily: (subject: string, day: number) => `qf:cosign:${subject}:${day}`,
}
