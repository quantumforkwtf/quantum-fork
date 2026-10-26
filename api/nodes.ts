import { createPublicClient, getAddress, type Hex, http, isAddress, isAddressEqual, recoverMessageAddress } from 'viem'
import { z } from 'zod'
import type { BurnReceipt } from '../src/protocol/receipt.js'
import type { DeploymentRecord } from '../src/protocol/deployment.js'
import {
  canRunNetwork,
  DESCENDANT_ID,
  enodeAddress,
  genesisDigest,
  genesisJson,
  LISTING_TTL_SECONDS,
  listingMessage,
  MAX_GENESIS_VALIDATORS,
  MAX_NODES_PER_DESCENDANT,
  MAX_NODES_PER_OPERATOR,
  NETWORK_FORMAT,
  type NodeListing,
  nodeId,
  networkParams,
  ownerAlloc,
  removalMessage,
  type SealedSpec,
  sealMessage,
  SIGNATURE_WINDOW_SECONDS,
  validateListing,
} from '../src/protocol/nodes.js'
import { type Context, HttpError, json, rateLimit, readJson, route } from './_lib/http.js'
import { getJson, keys } from './_lib/store.js'

interface StoredNode {
  id: string
  listing: NodeListing
  signature: Hex
  nodeSignature: Hex | null
  expiresAt: number
}

interface StoredNetwork {
  format: typeof NETWORK_FORMAT
  spec: SealedSpec
  signature: Hex
  genesisHash: Hex
}

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/).max(4000)
const listingSchema = z.object({
  descendant: z.string().max(100),
  role: z.enum(['validator', 'rpc']),
  enode: z.string().max(300).nullable(),
  rpcUrl: z.string().max(200).nullable(),
  label: z.string().max(40),
  operator: z.string().max(42),
  issuedAt: z.number().int(),
})
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), listing: listingSchema, signature: hex, nodeSignature: hex.nullable() }),
  z.object({ action: z.literal('remove'), descendant: z.string().max(100), node: z.string().max(120), operator: z.string().max(42), issuedAt: z.number().int(), signature: hex }),
  z.object({ action: z.literal('seal'), descendant: z.string().max(100), validators: z.array(z.string().max(42)).min(1).max(MAX_GENESIS_VALIDATORS), sealedAt: z.number().int(), signature: hex }),
])

const now = () => Math.floor(Date.now() / 1000)

/** EOA signatures are checked locally; anything else (smart wallets, ERC-1271/6492) is checked against Base. */
async function signedBy(context: Context, address: Hex, message: string, signature: Hex): Promise<boolean> {
  try {
    if (isAddressEqual(await recoverMessageAddress({ message, signature }), address)) return true
  } catch {
    // Not a plain ECDSA signature; try the wallet contract.
  }
  try {
    return await createPublicClient({ transport: http(context.env.baseRpcUrl) }).verifyMessage({ address, message, signature })
  } catch {
    return false
  }
}

async function nodeSignedBy(enode: string, message: string, signature: Hex | null): Promise<boolean> {
  if (!signature) return false
  try {
    return isAddressEqual(await recoverMessageAddress({ message, signature }), enodeAddress(enode)!)
  } catch {
    return false
  }
}

/** A registered descendant, its owner (the wallet whose burn registered it) and whether it can run as a network. */
async function descendantOf(context: Context, id: string) {
  if (!DESCENDANT_ID.test(id)) throw new HttpError(400, 'INVALID_REQUEST', 'Unknown descendant.')
  const record = await getJson<DeploymentRecord>(context.store, keys.deployment(id))
  if (!record || !record.burn.receiptId) throw new HttpError(404, 'NOT_FOUND', 'There is no registered descendant with that id.')
  const receipt = await getJson<BurnReceipt>(context.store, keys.receipt(record.burn.receiptId))
  const owner = record.burn.chain === 'base' && receipt && isAddress(receipt.wallet) ? getAddress(receipt.wallet) : null
  return {
    id: record.id,
    name: record.config.network.name,
    networkId: record.config.network.networkId,
    ancestor: record.config.ancestor,
    chain: record.burn.chain ?? 'solana',
    network: record.burn.network ?? null,
    owner,
    eligible: canRunNetwork(record.config) && owner !== null,
    params: networkParams(record.config),
  }
}

const liveNodes = async (context: Context, descendant: string) =>
  ((await getJson<{ nodes: StoredNode[] }>(context.store, keys.nodes(descendant)))?.nodes ?? []).filter((node) => node.expiresAt > now())

async function withLock<T>(context: Context, descendant: string, work: () => Promise<T>): Promise<T> {
  const lock = keys.nodesLock(descendant)
  if (!(await context.store.set(lock, '1', { nx: true, ttlSeconds: 10 }))) throw new HttpError(409, 'BUSY', 'The directory is being updated. Try again in a moment.')
  try {
    return await work()
  } finally {
    await context.store.del(lock).catch(() => undefined)
  }
}

function requireStore(context: Context) {
  if (!context.store.persistent && !context.env.dev) throw new HttpError(503, 'STORE_UNAVAILABLE', 'The node directory needs persistent storage.')
}

export const { GET, POST } = route('nodes', {
  async GET(context) {
    await rateLimit(context, 'read', 120)
    const id = context.url.searchParams.get('descendant') ?? ''
    const descendant = await descendantOf(context, id)
    const network = await getJson<StoredNetwork>(context.store, keys.network(descendant.id))
    if (context.url.searchParams.get('genesis') === '1') {
      if (!network) throw new HttpError(404, 'NOT_SEALED', 'This network’s genesis is not sealed yet.')
      return new Response(genesisJson(network.spec), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Content-Disposition': `attachment; filename="${descendant.networkId}.genesis.json"` } })
    }
    return json({ descendant, network, nodes: await liveNodes(context, descendant.id) }, 200, { 'Cache-Control': 'public, max-age=10' })
  },

  async POST(context) {
    requireStore(context)
    await rateLimit(context, 'nodes', 10)
    const body = await readJson(context, bodySchema)

    if (body.action === 'list') {
      const listing: NodeListing = { ...body.listing, operator: body.listing.operator as Hex }
      const problem = validateListing(listing, now())
      if (problem) throw new HttpError(400, 'INVALID_LISTING', problem)
      const descendant = await descendantOf(context, listing.descendant)
      if (!descendant.eligible) throw new HttpError(400, 'NOT_RUNNABLE', 'Only EVM descendants registered on Base can run a network.')
      const message = listingMessage(listing)
      if (!(await signedBy(context, listing.operator, message, body.signature as Hex))) throw new HttpError(401, 'BAD_SIGNATURE', 'The operator signature does not match.')
      if (listing.enode && !(await nodeSignedBy(listing.enode, message, body.nodeSignature as Hex | null))) throw new HttpError(401, 'BAD_NODE_SIGNATURE', 'The node key did not sign this listing. Create the listing with the node kit.')
      const id = nodeId(listing)
      return withLock(context, descendant.id, async () => {
        const nodes = await liveNodes(context, descendant.id)
        const existing = nodes.find((node) => node.id === id)
        if (existing && !isAddressEqual(existing.listing.operator, listing.operator)) throw new HttpError(409, 'TAKEN', 'Another operator has listed this node.')
        const others = nodes.filter((node) => node.id !== id)
        if (others.filter((node) => isAddressEqual(node.listing.operator, listing.operator)).length >= MAX_NODES_PER_OPERATOR) throw new HttpError(429, 'TOO_MANY', `An operator can list at most ${MAX_NODES_PER_OPERATOR} nodes per network.`)
        if (others.length >= MAX_NODES_PER_DESCENDANT) throw new HttpError(429, 'FULL', 'This network’s directory is full.')
        const stored: StoredNode = { id, listing: { ...listing, operator: getAddress(listing.operator) }, signature: body.signature as Hex, nodeSignature: (body.nodeSignature as Hex | null) ?? null, expiresAt: listing.issuedAt + LISTING_TTL_SECONDS }
        await context.store.set(keys.nodes(descendant.id), JSON.stringify({ nodes: [stored, ...others] }))
        context.log.info('node listed', { descendant: descendant.id, node: id, role: listing.role })
        return json({ node: stored }, existing ? 200 : 201)
      })
    }

    if (body.action === 'remove') {
      if (!isAddress(body.operator) || Math.abs(now() - body.issuedAt) > SIGNATURE_WINDOW_SECONDS) throw new HttpError(400, 'INVALID_REQUEST', 'The signature has expired. Sign again.')
      const descendant = await descendantOf(context, body.descendant)
      if (!(await signedBy(context, body.operator, removalMessage(descendant.id, body.operator, body.node, body.issuedAt), body.signature as Hex))) throw new HttpError(401, 'BAD_SIGNATURE', 'The operator signature does not match.')
      return withLock(context, descendant.id, async () => {
        const nodes = await liveNodes(context, descendant.id)
        const target = nodes.find((node) => node.id === body.node)
        if (!target || !isAddressEqual(target.listing.operator, body.operator as Hex)) throw new HttpError(404, 'NOT_FOUND', 'That operator has no such node listed.')
        await context.store.set(keys.nodes(descendant.id), JSON.stringify({ nodes: nodes.filter((node) => node !== target) }))
        return json({ removed: body.node })
      })
    }

    const descendant = await descendantOf(context, body.descendant)
    if (!descendant.eligible || !descendant.owner) throw new HttpError(400, 'NOT_RUNNABLE', 'Only EVM descendants registered on Base can run a network.')
    if (Math.abs(now() - body.sealedAt) > SIGNATURE_WINDOW_SECONDS) throw new HttpError(400, 'INVALID_REQUEST', 'The signature has expired. Sign again.')
    const listed = new Map((await liveNodes(context, descendant.id)).filter((node) => node.listing.role === 'validator').map((node) => [node.id, node]))
    const validators = [...new Set(body.validators.map((validator) => validator.toLowerCase()))]
    if (validators.length !== body.validators.length) throw new HttpError(400, 'INVALID_REQUEST', 'A validator is listed twice.')
    for (const validator of validators) if (!listed.has(validator)) throw new HttpError(400, 'NOT_LISTED', `${validator} is not a listed validator of this network.`)
    const spec: SealedSpec = {
      descendant: descendant.id,
      networkId: descendant.networkId,
      name: descendant.name,
      params: descendant.params,
      validators: validators.map((validator) => getAddress(validator)),
      alloc: ownerAlloc(descendant.owner),
      owner: descendant.owner,
      sealedAt: body.sealedAt,
    }
    if (!(await signedBy(context, descendant.owner, sealMessage(spec), body.signature as Hex))) throw new HttpError(401, 'BAD_SIGNATURE', 'Only the wallet that registered this descendant can seal its genesis.')
    const stored: StoredNetwork = { format: NETWORK_FORMAT, spec, signature: body.signature as Hex, genesisHash: genesisDigest(spec) }
    if (!(await context.store.set(keys.network(descendant.id), JSON.stringify(stored), { nx: true }))) throw new HttpError(409, 'SEALED', 'This network’s genesis is already sealed. Add validators by vote instead.')
    context.log.info('network sealed', { descendant: descendant.id, validators: spec.validators.length })
    return json({ network: stored }, 201)
  },
})
