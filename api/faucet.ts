import { z } from 'zod'
import { isBase58Address } from '../src/protocol/address.js'
import { dripFaucet, faucetAvailability } from './_lib/faucet.js'
import { json, rateLimit, readJson, route } from './_lib/http.js'

const schema = z.object({ wallet: z.string().refine(isBase58Address, 'Not an address') }).strict()

export const { GET, POST } = route('faucet', {
  async GET(context) {
    await rateLimit(context, 'read', 120)
    return json(faucetAvailability(context))
  },
  async POST(context) {
    await rateLimit(context, 'faucet', 5)
    const body = await readJson(context, schema)
    return json(await dripFaucet(context, body.wallet))
  },
})
