import { z } from 'zod'
import { GHOST_LIFETIMES, GHOST_SPEC, isLifetime } from '../src/protocol/ghostChain.js'
import { createGhost, listGhosts, snapshotGhost, terminateGhost } from './_lib/ghosts.js'
import { HttpError, json, rateLimit, readJson, route } from './_lib/http.js'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), lifetime: z.string().refine(isLifetime, 'Lifetime must be 15m, 1h, 6h, or 24h.') }).strict(),
  z.object({ action: z.literal('terminate'), id: z.string().regex(/^gh_[0-9a-f]{12}$/) }).strict(),
  z.object({ action: z.literal('snapshot'), id: z.string().regex(/^gh_[0-9a-f]{12}$/) }).strict(),
])

function local(contextDev: boolean) {
  if (!contextDev) throw new HttpError(501, 'LOCAL_ONLY', 'This server does not start chains. Ghost Chains run on a local machine.')
}

/** Local temporary Anvil networks. Production hosts do not start them. */
export const { GET, POST } = route('ghosts', {
  async GET(context) {
    await rateLimit(context, 'read', 120)
    if (!context.env.dev) return json({ available: false, spec: GHOST_SPEC, environments: [], reason: 'This server does not start chains. Ghost Chains run on a local machine.' })
    return json({ available: true, spec: GHOST_SPEC, lifetimes: GHOST_LIFETIMES, environments: await listGhosts(), reason: null })
  },
  async POST(context) {
    local(context.env.dev)
    await rateLimit(context, 'ghost', 10, 60)
    const body = await readJson(context, bodySchema)
    try {
      if (body.action === 'create') return json({ environment: await createGhost(body.lifetime) }, 201)
      if (body.action === 'terminate') return json({ environment: await terminateGhost(body.id) })
      return json(await snapshotGhost(body.id))
    } catch (cause) {
      throw new HttpError(409, 'GHOST_FAILED', cause instanceof Error ? cause.message : 'The environment did not change.')
    }
  },
})
