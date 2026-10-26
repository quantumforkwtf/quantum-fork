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

/** A 32-byte secp256k1 key as 0x-hex. Server-only; never logged or returned. */
function evmKey(raw: string | undefined) {
  const value = raw?.trim()
  return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as `0x${string}`) : null
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
  const cosignerKey = evmKey(env.COSIGNER_PRIVATE_KEY)
  if (env.ENABLE_HOSTED_COSIGNER === 'true' && !cosignerKey) issues.push({ key: 'COSIGNER_PRIVATE_KEY', level: 'error', message: 'The hosted co-signer is enabled but COSIGNER_PRIVATE_KEY is missing or not a 32-byte hex key.' })
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
    /** Off unless explicitly enabled with a key. The key never leaves the server. */
    cosignerKey: env.ENABLE_HOSTED_COSIGNER === 'true' ? cosignerKey : null,
    dev,
    logLevel: (env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  }
}

export type ServerEnv = ReturnType<typeof serverEnv>
