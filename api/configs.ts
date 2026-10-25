import { z } from 'zod'
import { chainDnaSchema } from '../src/protocol/chainDna.js'
import { isTxHash } from '../src/protocol/base.js'
import { listConfigs, publishConfig, readConfig, verifyAnchor } from './_lib/configs.js'
import { HttpError, json, rateLimit, readJson, route } from './_lib/http.js'

const hash = z.string().regex(/^0x[0-9a-f]{64}$/, 'Not a configuration hash')

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), dna: chainDnaSchema }).strict(),
  z.object({ action: z.literal('verify-anchor'), hash, txHash: z.string().refine(isTxHash, 'Not a transaction hash') }).strict(),
])

/** Published Chain DNA configurations and their verified Base registry anchors. */
export const { GET, POST } = route('configs', {
  async GET(context) {
    await rateLimit(context, 'read', 120)
    const requested = context.url.searchParams.get('hash')
    if (requested !== null) {
      if (!hash.safeParse(requested).success) throw new HttpError(400, 'INVALID_HASH', 'Pass ?hash=0x… (64 lowercase hex digits).')
      return json(await readConfig(context, requested), 200, { 'Cache-Control': 'public, max-age=30' })
    }
    return json(await listConfigs(context), 200, { 'Cache-Control': 'public, max-age=15' })
  },
  async POST(context) {
    const body = await readJson(context, actionSchema)
    if (body.action === 'publish') {
      await rateLimit(context, 'publish', 10)
      const { config, created } = await publishConfig(context, body.dna)
      return json({ config }, created ? 201 : 200)
    }
    await rateLimit(context, 'verify', 60)
    const outcome = await verifyAnchor(context, { hash: body.hash as `0x${string}`, txHash: body.txHash as `0x${string}` })
    return json(outcome, outcome.status === 'PENDING' ? 202 : outcome.status === 'FAILED' ? 422 : 200)
  },
})
