import type { DeploymentRecord } from '../src/protocol/deployment.js'
import { json, rateLimit, route } from './_lib/http.js'
import { getJson, keys } from './_lib/store.js'

/** Registered descendants: each one's burn was verified on-chain by the server. */
export const { GET, POST } = route('descendants', {
  async GET(context) {
    await rateLimit(context, 'read', 120)
    if (!context.store.persistent) return json({ persistent: false, descendants: [] })
    const ids = await context.store.lrange(keys.descendants, 0, 99)
    const records = await Promise.all(ids.map((id) => getJson<DeploymentRecord>(context.store, keys.deployment(id))))
    const networks = new Set<string>([context.env.config.network, context.env.base.network])
    const descendants = records
      .filter((record): record is DeploymentRecord => record !== null && record.burn.receiptId !== null && networks.has(record.burn.network ?? ''))
      .map((record) => ({
        id: record.id,
        descendantId: record.descendantId,
        config: record.config,
        tier: record.tier,
        chain: record.burn.chain ?? 'solana',
        network: record.burn.network,
        state: record.state,
        genomeHash: record.genomeHash,
        receipt: record.burn.receiptId,
        createdAt: record.createdAt,
      }))
    return json({ persistent: true, descendants }, 200, { 'Cache-Control': 'public, max-age=15' })
  },
})
