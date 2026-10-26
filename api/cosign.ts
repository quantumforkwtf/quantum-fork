import { privateKeyToAccount } from 'viem/accounts'
import { BASE_CHAIN_ID } from '../src/protocol/base.js'
import { parseCosignRequest } from '../src/protocol/cosigner.js'
import { cosign } from '../src/protocol/cosignerService.js'
import { type Context, HttpError, json, rateLimit, route } from './_lib/http.js'
import { keys } from './_lib/store.js'

/** Key sets with several ML-DSA guardians exceed the default API body limit. */
const MAX_COSIGN_BODY_BYTES = 256 * 1024
/** Approvals cost the hosted key gas, and anyone can make an account that names it as an owner. */
const DAILY_APPROVALS = { total: 500, perAccount: 20 }

function info(context: Context) {
  const key = context.env.cosignerKey
  const network = context.env.base.network
  return {
    name: 'qfork-cosigner',
    version: 1,
    mode: 'hosted',
    trust: 'server-trusted',
    enabled: Boolean(key),
    address: key ? privateKeyToAccount(key).address : null,
    network,
    chainId: BASE_CHAIN_ID[network],
  }
}

async function readBody(context: Context): Promise<unknown> {
  if (!(context.request.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send application/json.')
  if (Number(context.request.headers.get('content-length') ?? 0) > MAX_COSIGN_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.')
  const text = await context.request.text()
  if (new TextEncoder().encode(text).length > MAX_COSIGN_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON.')
  }
}

async function underDailyCap(context: Context, subject: string, limit: number) {
  const day = Math.floor(Date.now() / 86_400_000)
  const key = keys.cosignDaily(subject, day)
  const count = await context.store.incr(key)
  if (count === 1) await context.store.expire(key, 86_400 + 60)
  return count <= limit
}

export const { GET, POST } = route('cosign', {
  async GET(context) {
    await rateLimit(context, 'read', 120)
    return json(info(context))
  },
  async POST(context) {
    const key = context.env.cosignerKey
    if (!key) throw new HttpError(503, 'COSIGNER_DISABLED', 'The hosted co-signer is not enabled. Run your own with `npm run cosigner`.')
    await rateLimit(context, 'cosign', 6)
    const request = parseCosignRequest(await readBody(context))
    if (typeof request === 'string') throw new HttpError(400, 'INVALID_REQUEST', request)
    const network = context.env.base.network
    if (request.chainId !== BASE_CHAIN_ID[network]) throw new HttpError(400, 'WRONG_CHAIN', `The hosted co-signer runs on chain ${BASE_CHAIN_ID[network]}.`)
    if (!context.store.persistent && !context.env.dev) throw new HttpError(503, 'STORE_UNAVAILABLE', 'The hosted co-signer needs persistent storage for its limits.')

    const account = request.account.toLowerCase()
    const lock = keys.cosignLock(account, request.proposalId.toString())
    if (!(await context.store.set(lock, '1', { nx: true, ttlSeconds: 90 }))) throw new HttpError(409, 'IN_PROGRESS', 'This proposal is already being co-signed.')
    try {
      const beforeApprove = async () =>
        (await underDailyCap(context, `acct:${account}`, DAILY_APPROVALS.perAccount)) && (await underDailyCap(context, 'total', DAILY_APPROVALS.total))
          ? null
          : 'The hosted co-signer has reached its daily approval limit. Run your own with `npm run cosigner`.'
      const outcome = await cosign({ rpcUrl: context.env.baseRpcUrl, chainId: BASE_CHAIN_ID[network], signer: privateKeyToAccount(key), receiptTimeoutMs: 40_000, beforeApprove }, request)
      if (!outcome.ok) throw new HttpError(outcome.code === 'LIMITED' ? 429 : 422, outcome.code, outcome.message)
      context.log.info('co-signed', { account, proposalId: request.proposalId.toString(), class: outcome.class, signers: outcome.signers.length, hash: outcome.hash })
      return json({ hash: outcome.hash, class: outcome.class, signers: outcome.signers.length, trust: 'server-trusted' })
    } finally {
      await context.store.del(lock).catch(() => undefined)
    }
  },
})
