import { z } from 'zod'
import { isSignature } from '../src/protocol/address.js'
import { isTxHash } from '../src/protocol/base.js'
import type { BurnReceipt } from '../src/protocol/receipt.js'
import { submitBurn } from './_lib/deployments.js'
import { HttpError, json, rateLimit, readJson, route } from './_lib/http.js'
import { getJson, keys } from './_lib/store.js'

const submitSchema = z
  .object({
    deploymentId: z.string().regex(/^dep_[a-z0-9]{16,32}$/),
    signature: z.string().refine((value) => isSignature(value) || isTxHash(value), 'Not a transaction signature or hash'),
  })
  .strict()

export const { GET, POST } = route('burns', {
  /** Public receipt lookup by transaction signature. */
  async GET(context) {
    await rateLimit(context, 'read', 120)
    const signature = context.url.searchParams.get('signature') ?? ''
    if (!isSignature(signature) && !isTxHash(signature)) throw new HttpError(400, 'INVALID_SIGNATURE', 'Not a transaction signature.')
    const receipt = await getJson<BurnReceipt>(context.store, keys.receipt(signature))
    if (!receipt) throw new HttpError(404, 'NOT_FOUND', 'No verified Quantum Fork burn exists for this signature.')
    return json({ receipt }, 200, { 'Cache-Control': 'public, max-age=60' })
  },
  /**
   * Binds a submitted transaction to a deployment and verifies it on-chain.
   * The client only supplies the signature; amount, mint, wallet and success
   * are all read from the finalized transaction.
   */
  async POST(context) {
    await rateLimit(context, 'burn', 30)
    const body = await readJson(context, submitSchema)
    const outcome = await submitBurn(context, body.deploymentId, body.signature)
    if (outcome.status === 'PENDING') return json(outcome, 202, { 'Retry-After': '3' })
    if (outcome.status === 'FAILED') return json(outcome, 422)
    return json(outcome, 200)
  },
})
