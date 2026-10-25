import type { Hex } from 'viem'
import { type ChainDna, canonicalJson, dnaHash, normalizeDna, REGISTRY_KIND, TARGETS, technicalHash, validateDna } from '../../src/protocol/chainDna.js'
import { verifyRegistration } from '../../src/protocol/registry.js'
import { readBaseBurn } from './evm.js'
import { type Context, HttpError } from './http.js'
import { getJson } from './store.js'

export interface PublishedConfig {
  hash: Hex
  technicalHash: Hex
  dna: ChainDna
  publishedAt: string
}

export interface AnchorRecord {
  configHash: Hex
  recordId: Hex
  creator: Hex
  network: string
  chainId: number
  registry: Hex
  kind: number
  version: number
  parent: Hex
  metadataURI: string
  txHash: Hex
  blockNumber: number
  verifiedAt: string
}

export const configKeys = {
  config: (hash: string) => `qf:dna:${hash}`,
  list: 'qf:dnas',
  anchors: (hash: string) => `qf:dna:anchors:${hash}`,
  anchor: (recordId: string) => `qf:anchor:${recordId}`,
  anchorTx: (txHash: string) => `qf:anchortx:${txHash}`,
}

const MAX_LIST = 100

function requireStorage(context: Context) {
  if (!context.store.persistent) throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'Server storage is not configured, so configurations cannot be published here. Export the file instead.')
}

/** Stores a configuration under the hash the server computes. Publishing the same document twice is a no-op. */
export async function publishConfig(context: Context, dna: ChainDna): Promise<{ config: PublishedConfig; created: boolean }> {
  requireStorage(context)
  if (canonicalJson(normalizeDna(dna)) !== canonicalJson(dna)) throw new HttpError(422, 'NOT_NORMALIZED', `This configuration sets values ${TARGETS[dna.target].label.toLowerCase()} fixes. Open it in the studio and save it again.`)
  const errors = validateDna(dna).filter((issue) => issue.level === 'error')
  if (errors.length) throw new HttpError(422, 'INVALID_CONFIG', 'The configuration has compatibility errors.', { issues: errors.slice(0, 10) })
  const hash = dnaHash(dna)
  const existing = await getJson<PublishedConfig>(context.store, configKeys.config(hash))
  if (existing) return { config: existing, created: false }
  const config: PublishedConfig = { hash, technicalHash: technicalHash(dna), dna, publishedAt: new Date().toISOString() }
  const claimed = await context.store.set(configKeys.config(hash), JSON.stringify(config), { nx: true })
  if (!claimed) return { config: (await getJson<PublishedConfig>(context.store, configKeys.config(hash))) ?? config, created: false }
  await context.store.lpush(configKeys.list, hash)
  context.log.info('config published', { hash, target: dna.target })
  return { config, created: true }
}

export async function readConfig(context: Context, hash: string) {
  const config = await getJson<PublishedConfig>(context.store, configKeys.config(hash))
  if (!config) throw new HttpError(404, 'NOT_FOUND', 'No configuration was published with this hash.')
  const ids = await context.store.lrange(configKeys.anchors(hash), 0, 49)
  const anchors = (await Promise.all(ids.map((id) => getJson<AnchorRecord>(context.store, configKeys.anchor(id))))).filter((item): item is AnchorRecord => item !== null)
  return { config, anchors }
}

export async function listConfigs(context: Context) {
  if (!context.store.persistent) return { persistent: false, configs: [] }
  const hashes = [...new Set(await context.store.lrange(configKeys.list, 0, MAX_LIST - 1))]
  const configs = await Promise.all(
    hashes.map(async (hash) => {
      const config = await getJson<PublishedConfig>(context.store, configKeys.config(hash))
      if (!config) return null
      const anchors = await context.store.lrange(configKeys.anchors(hash), 0, 49)
      return { hash: config.hash, technicalHash: config.technicalHash, dna: config.dna, publishedAt: config.publishedAt, anchors: anchors.length }
    }),
  )
  return { persistent: true, configs: configs.filter((item) => item !== null) }
}

export type AnchorOutcome = { status: 'PENDING' } | { status: 'VERIFIED'; anchor: AnchorRecord } | { status: 'FAILED'; code: string; message: string }

/** Records an on-chain registration after reading it from Base at a finalized block. */
export async function verifyAnchor(context: Context, input: { hash: Hex; txHash: Hex }): Promise<AnchorOutcome> {
  requireStorage(context)
  const registry = context.env.base.registry
  if (!registry) throw new HttpError(409, 'REGISTRY_NOT_DEPLOYED', 'No Quantum Fork registry is configured on this server (QFORK_REGISTRY_ADDRESS).')
  const published = await getJson<PublishedConfig>(context.store, configKeys.config(input.hash))
  if (!published) throw new HttpError(404, 'NOT_FOUND', 'Publish the configuration before anchoring it, so its metadata URI resolves.')

  const bound = await context.store.get(configKeys.anchorTx(input.txHash))
  if (bound) {
    const anchor = await getJson<AnchorRecord>(context.store, configKeys.anchor(bound))
    if (anchor && anchor.configHash === input.hash) return { status: 'VERIFIED', anchor }
    throw new HttpError(409, 'TX_USED', 'This transaction already anchored a different record.')
  }

  const { tx, receipt, finalized } = await readBaseBurn(context, input.txHash)
  const verification = verifyRegistration(tx, receipt, { registry, chainId: context.env.base.chainId, configHash: input.hash, kind: REGISTRY_KIND[published.dna.target] })
  if (!verification.ok) {
    if (verification.code === 'TX_NOT_FOUND') return { status: 'PENDING' }
    context.log.warn('anchor rejected', { hash: input.hash, code: verification.code })
    return { status: 'FAILED', code: verification.code, message: verification.message }
  }
  if (verification.blockNumber > finalized) return { status: 'PENDING' }

  const anchor: AnchorRecord = {
    configHash: input.hash,
    recordId: verification.recordId,
    creator: verification.creator,
    network: context.env.base.network,
    chainId: context.env.base.chainId,
    registry,
    kind: verification.kind,
    version: verification.version,
    parent: verification.parent,
    metadataURI: verification.metadataURI,
    txHash: input.txHash,
    blockNumber: Number(verification.blockNumber),
    verifiedAt: new Date().toISOString(),
  }
  const claimed = await context.store.set(configKeys.anchor(anchor.recordId), JSON.stringify(anchor), { nx: true })
  if (claimed) {
    await context.store.set(configKeys.anchorTx(input.txHash), anchor.recordId, { nx: true })
    await context.store.lpush(configKeys.anchors(input.hash), anchor.recordId)
    context.log.info('anchor verified', { hash: input.hash, recordId: anchor.recordId })
    return { status: 'VERIFIED', anchor }
  }
  return { status: 'VERIFIED', anchor: (await getJson<AnchorRecord>(context.store, configKeys.anchor(anchor.recordId))) ?? anchor }
}
