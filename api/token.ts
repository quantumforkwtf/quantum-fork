import type { Hex } from 'viem'
import { baseTokenDecimals, baseTokenSupply } from './_lib/evm.js'
import { type Context, HttpError, json, rateLimit, route } from './_lib/http.js'
import { pumpfunAdapter } from './_lib/pumpfun.js'
import { rpcFailure } from './_lib/rpc.js'
import { getJson, keys } from './_lib/store.js'

const CACHE_SECONDS = 30

/** Base $QFORK, read from Base. Failures are reported in the block instead of failing the whole response. */
async function baseToken(context: Context) {
  const { base } = context.env
  const protocol = context.store.persistent
    ? {
        burnedWhole: (await context.store.get(keys.burnedWhole(base.network))) ?? '0',
        burnCount: Number((await context.store.get(keys.burnCount(base.network))) ?? 0),
        source: 'verified receipts',
      }
    : null
  if (base.tokenStatus !== 'LIVE' || !base.token) return { status: 'PRELAUNCH' as const, network: base.network, token: null, protocol: null }

  const cacheKey = keys.cache(`token:${base.network}:${base.token}`)
  const cached = await getJson<Record<string, unknown>>(context.store, cacheKey).catch(() => null)
  if (cached) return { ...cached, protocol, cached: true }

  try {
    const token = base.token as Hex
    const [decimals, supply] = await Promise.all([baseTokenDecimals(context, token), baseTokenSupply(context, token)])
    const body = { status: 'LIVE' as const, network: base.network, token: base.token, decimals, supplyRaw: supply.toString(), clankerUrl: base.clankerUrl, error: null, fetchedAt: new Date().toISOString() }
    await context.store.set(cacheKey, JSON.stringify(body), { ttlSeconds: CACHE_SECONDS }).catch(() => undefined)
    return { ...body, protocol, cached: false }
  } catch {
    return { status: 'LIVE' as const, network: base.network, token: base.token, decimals: null, supplyRaw: null, clankerUrl: base.clankerUrl, error: 'Base token data is unavailable right now.', protocol }
  }
}

export const { GET, POST } = route('token', {
  async GET(context) {
    await rateLimit(context, 'read', 120)
    const { config } = context.env
    const base = await baseToken(context)
    const protocol = context.store.persistent
      ? {
          burnedRaw: (await context.store.get(keys.burnedRaw(config.network))) ?? '0',
          burnCount: Number((await context.store.get(keys.burnCount(config.network))) ?? 0),
          source: 'verified receipts',
        }
      : null

    if (config.tokenStatus !== 'LIVE' || !config.mint) {
      return json({ status: 'PRELAUNCH', network: config.network, mint: null, token: null, market: null, protocol: null, base, fetchedAt: new Date().toISOString() })
    }

    const cacheKey = keys.cache(`token:${config.network}:${config.mint}`)
    const cached = await getJson<Record<string, unknown>>(context.store, cacheKey).catch(() => null)
    if (cached) return json({ ...cached, protocol, base, cached: true })

    const adapter = pumpfunAdapter(config.rpcUrl)
    let token
    try {
      token = await adapter.getToken(config.mint)
    } catch (error) {
      throw rpcFailure(error)
    }
    if (!token) throw new HttpError(502, 'MINT_NOT_FOUND', 'The configured mint does not exist on this network.')

    let market = null
    let marketError: string | null = null
    if (config.flags.pumpfunData) {
      try {
        market = await adapter.getMarketData(config.mint, token.decimals)
        if (!market) marketError = 'No Pump bonding curve exists for this mint.'
      } catch {
        marketError = 'Pump market data is unavailable right now.'
      }
    }

    const body = {
      status: 'LIVE',
      network: config.network,
      mint: config.mint,
      token,
      market,
      marketError,
      tradingLink: config.pumpfunUrl,
      fetchedAt: new Date().toISOString(),
    }
    await context.store.set(cacheKey, JSON.stringify(body), { ttlSeconds: CACHE_SECONDS }).catch(() => undefined)
    return json({ ...body, protocol, base, cached: false })
  },
})
