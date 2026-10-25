import { z } from 'zod'
import { descendantSchema } from '../src/protocol/descendant.js'
import { createDeployment, readDeployment } from './_lib/deployments.js'
import { HttpError, json, rateLimit, readJson, route } from './_lib/http.js'
import { tokensOf } from './_lib/tokens.js'

const createSchema = z.object({ config: descendantSchema, chain: z.enum(['solana', 'base']).optional() }).strict()

export const { GET, POST } = route('deployments', {
  async GET(context) {
    await rateLimit(context, 'read', 120)
    const id = context.url.searchParams.get('id')
    if (!id) throw new HttpError(400, 'MISSING_ID', 'Pass ?id=<deployment id>.')
    const found = await readDeployment(context, id)
    return json({ ...found, tokens: await tokensOf(context, found.deployment.id) })
  },
  async POST(context) {
    await rateLimit(context, 'deploy', 10)
    const idempotencyKey = context.request.headers.get('idempotency-key')
    if (!idempotencyKey || !/^[a-zA-Z0-9-]{16,64}$/.test(idempotencyKey)) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (16–64 characters).')
    }
    const body = await readJson(context, createSchema)
    return json(await createDeployment(context, body.config, idempotencyKey, body.chain ?? 'solana'), 201)
  },
})
