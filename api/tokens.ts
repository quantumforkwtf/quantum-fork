import { getAddress, isAddress } from 'viem'
import { z } from 'zod'
import { isBase58Address, isSignature } from '../src/protocol/address.js'
import { isTxHash } from '../src/protocol/base.js'
import { clankerSpecSchema, pumpSpecSchema, splSpecSchema, type TokenRecord } from '../src/protocol/tokens.js'
import { HttpError, json, rateLimit, readJson, route } from './_lib/http.js'
import { getJson, keys } from './_lib/store.js'
import { prepareClanker, preparePump, prepareSpl, relayPump, tokensOf, verifyClanker, verifyLaunch } from './_lib/tokens.js'

const address = z.string().refine(isBase58Address, 'Not an address')
const evmAddress = z.string().refine((value) => isAddress(value), 'Not an address')
const deploymentId = z.string().regex(/^dep_[a-z0-9]{16,32}$/)
const launchId = z.string().regex(/^clk_[0-9a-f]{32}$/)
const isTokenAddress = (value: string) => isBase58Address(value) || isAddress(value)

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare-spl'), deploymentId, wallet: address, spec: splSpecSchema }).strict(),
  z.object({ action: z.literal('prepare-pumpfun'), deploymentId, wallet: address, mint: address, spec: pumpSpecSchema }).strict(),
  z.object({ action: z.literal('relay'), mint: address, transaction: z.string().min(100).max(4000) }).strict(),
  z.object({ action: z.literal('verify'), mint: address, signature: z.string().refine(isSignature, 'Not a transaction signature') }).strict(),
  z.object({ action: z.literal('prepare-clanker'), deploymentId, wallet: evmAddress, spec: clankerSpecSchema }).strict(),
  z.object({ action: z.literal('verify-clanker'), launchId, hash: z.string().refine(isTxHash, 'Not a transaction hash') }).strict(),
])

export const { GET, POST } = route('tokens', {
  /** ?meta=<mint> serves the token's metadata JSON; ?mint= one record; ?deployment= a descendant's tokens. */
  async GET(context) {
    await rateLimit(context, 'read', 180)
    const params = context.url.searchParams
    const meta = params.get('meta')
    if (meta) {
      if (!isBase58Address(meta) && !launchId.safeParse(meta).success) throw new HttpError(400, 'INVALID_MINT', 'Not a mint address.')
      const raw = await context.store.get(keys.meta(meta))
      if (!raw) throw new HttpError(404, 'NOT_FOUND', 'No metadata for this mint.')
      return new Response(raw, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } })
    }
    const mint = params.get('mint')
    if (mint) {
      if (!isTokenAddress(mint)) throw new HttpError(400, 'INVALID_MINT', 'Not a mint address.')
      const token = await getJson<TokenRecord>(context.store, keys.token(isAddress(mint) ? getAddress(mint) : mint))
      if (!token) throw new HttpError(404, 'NOT_FOUND', 'No verified token with this mint.')
      return json({ token }, 200, { 'Cache-Control': 'public, max-age=30' })
    }
    const deployment = params.get('deployment') ?? ''
    if (!/^dep_[a-z0-9]{16,32}$/.test(deployment)) throw new HttpError(400, 'MISSING_ID', 'Pass ?deployment=<deployment id>.')
    return json({ tokens: await tokensOf(context, deployment) }, 200, { 'Cache-Control': 'public, max-age=10' })
  },
  async POST(context) {
    const body = await readJson(context, actionSchema)
    if (!context.store.persistent) throw new HttpError(503, 'STORAGE_NOT_PERSISTENT', 'Server storage is not configured, so tokens cannot be recorded.')
    switch (body.action) {
      case 'prepare-spl':
        await rateLimit(context, 'launch', 6)
        return json(await prepareSpl(context, body), 201)
      case 'prepare-pumpfun':
        await rateLimit(context, 'launch', 6)
        return json(await preparePump(context, body), 201)
      case 'relay':
        await rateLimit(context, 'relay', 6)
        return json(await relayPump(context, body))
      case 'verify': {
        await rateLimit(context, 'verify', 60)
        const outcome = await verifyLaunch(context, body)
        return json(outcome, outcome.status === 'PENDING' ? 202 : outcome.status === 'FAILED' ? 422 : 200)
      }
      case 'prepare-clanker':
        await rateLimit(context, 'launch', 6)
        return json(await prepareClanker(context, body), 201)
      case 'verify-clanker': {
        await rateLimit(context, 'verify', 60)
        const outcome = await verifyClanker(context, body)
        return json(outcome, outcome.status === 'PENDING' ? 202 : outcome.status === 'FAILED' ? 422 : 200)
      }
    }
  },
})
