import { BASE_PUBLIC_RPC, resolveBaseConfig } from '../../src/protocol/base.js'
import { PUBLIC_RPC, resolveConfig } from '../../src/protocol/config.js'

/** A 64-byte Solana keypair as the JSON array `solana-keygen` writes. Server-only; never logged or returned. */
function keypair(raw: string | undefined) {
  if (!raw) return null
  try {
    const bytes = JSON.parse(raw) as unknown
    if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null
    return Uint8Array.from(bytes as number[])
  } catch {
    return null
  }
}

/** Server configuration. Read from process.env; nothing here is sent to clients except via toPublic(). */
export function serverEnv() {
  const env = process.env as Record<string, string | undefined>
  const { config, issues } = resolveConfig(env)
  const base = resolveBaseConfig(env)
  issues.push(...base.issues)
  const local = env.NODE_ENV !== 'production' && !env.VERCEL
  let baseRpcUrl = env.BASE_RPC_URL?.trim() || BASE_PUBLIC_RPC[base.config.network]
  if (!/^https:\/\//.test(baseRpcUrl) && !(local && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(baseRpcUrl))) {
    issues.push({ key: 'BASE_RPC_URL', level: 'error', message: 'BASE_RPC_URL must use https. Falling back to the public endpoint.' })
    baseRpcUrl = BASE_PUBLIC_RPC[base.config.network]
  }
  const kvUrl = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL
  const kvToken = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN
  const allowed = new Set<string>([new URL(config.siteUrl).origin])
  for (const origin of (env.ALLOWED_ORIGINS ?? '').split(',')) if (origin.trim()) allowed.add(origin.trim().replace(/\/$/, ''))
  if (env.VERCEL_URL) allowed.add(`https://${env.VERCEL_URL}`)
  if (env.VERCEL_BRANCH_URL) allowed.add(`https://${env.VERCEL_BRANCH_URL}`)
  const dev = local
  return {
    config,
    issues,
    base: base.config,
    /** Server-only; may carry a provider key. Never returned to clients. */
    baseRpcUrl,
    kv: kvUrl && kvToken ? { url: kvUrl.replace(/\/$/, ''), token: kvToken } : null,
    allowedOrigins: allowed,
    mainnetRpcUrl: env.MAINNET_RPC_URL?.trim() || PUBLIC_RPC['mainnet-beta'],
    faucetKey: config.network === 'mainnet-beta' ? null : keypair(env.QFORK_FAUCET_KEYPAIR),
    dev,
    logLevel: (env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  }
}

export type ServerEnv = ReturnType<typeof serverEnv>
