import { isSignature } from '../../src/protocol/address.js'
import { baseAvailability, baseTier, burnedInReceipt, burnTag, type Chain, isTxHash, verifyEvmBurn } from '../../src/protocol/base.js'
import { tierAvailability } from '../../src/protocol/config.js'
import { burnMemo, type DeploymentRecord, newDeploymentId, transition } from '../../src/protocol/deployment.js'
import { type DescendantConfig, genomeHash, normalizeConfig } from '../../src/protocol/descendant.js'
import { quoteGenesis, toBaseUnits } from '../../src/protocol/pricing.js'
import { type BurnReceipt, descendantCode } from '../../src/protocol/receipt.js'
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM, verifyBurnTransaction } from '../../src/protocol/verifyBurn.js'
import { type Context, HttpError, randomToken } from './http.js'
import { baseTokenDecimals, readBaseBurn } from './evm.js'
import { rpcClient, rpcFailure } from './rpc.js'
import { getJson, keys } from './store.js'

const EXPIRY_MS = 180_000

export interface PublicDeployment {
  deployment: DeploymentRecord
  receipt: BurnReceipt | null
}

async function withLock<T>(context: Context, id: string, work: () => Promise<T>): Promise<T> {
  const lock = keys.depLock(id)
  const owner = randomToken(8)
  const acquired = await context.store.set(lock, owner, { nx: true, ttlSeconds: 15 })
  if (!acquired) throw new HttpError(409, 'DEPLOYMENT_BUSY', 'This deployment is being updated. Retry in a few seconds.')
  try {
    return await work()
  } finally {
    if ((await context.store.get(lock)) === owner) await context.store.del(lock)
  }
}

async function save(context: Context, record: DeploymentRecord) {
  await context.store.set(keys.deployment(record.id), JSON.stringify(record))
}

export async function loadDeployment(context: Context, id: string) {
  if (!/^dep_[a-z0-9]{16,32}$/.test(id)) throw new HttpError(400, 'INVALID_ID', 'Invalid deployment id.')
  const record = await getJson<DeploymentRecord>(context.store, keys.deployment(id))
  if (!record) throw new HttpError(404, 'NOT_FOUND', 'No deployment with this id exists.')
  return record
}

function requireLiveTier(context: Context, tier: DescendantConfig['tier'], chain: Chain) {
  if (!context.store.persistent) {
    throw new HttpError(503, 'STORAGE_NOT_PERSISTENT', 'Server storage is not configured. Burns that need a permanent receipt are disabled.')
  }
  if (chain === 'base') {
    const { base } = context.env
    if (tier !== baseTier(base.network)) {
      throw new HttpError(403, 'TIER_UNAVAILABLE', base.network === 'base' ? 'Base registration is mainnet only on this site.' : 'This site registers on Base Sepolia, which is the testnet tier.')
    }
    const availability = baseAvailability(base, true)
    if (!availability.available) throw new HttpError(403, 'TIER_UNAVAILABLE', availability.reason)
    return
  }
  const availability = tierAvailability(context.env.config, tier)
  if (!availability.available) throw new HttpError(403, 'TIER_UNAVAILABLE', availability.reason)
}

function chainOf(record: DeploymentRecord): Chain {
  return record.burn.chain ?? 'solana'
}

export async function createDeployment(context: Context, input: DescendantConfig, idempotencyKey: string | null, chain: Chain = 'solana'): Promise<PublicDeployment> {
  const config = normalizeConfig(input)
  requireLiveTier(context, config.tier, chain)
  if (config.profile === 'research' && !context.env.config.flags.experimentalPq) {
    throw new HttpError(403, 'EXPERIMENTAL_DISABLED', 'The research profile can be designed and exported, but registration with it is switched off (ENABLE_EXPERIMENTAL_PQ).')
  }

  if (idempotencyKey) {
    const existing = await context.store.get(keys.idempotency(idempotencyKey))
    if (existing) return { deployment: await loadDeployment(context, existing), receipt: null }
  }

  const id = newDeploymentId(() => randomToken(10))
  if (idempotencyKey) {
    const claimed = await context.store.set(keys.idempotency(idempotencyKey), id, { nx: true, ttlSeconds: 86_400 })
    if (!claimed) {
      const winner = await context.store.get(keys.idempotency(idempotencyKey))
      if (winner) return { deployment: await loadDeployment(context, winner), receipt: null }
    }
  }

  const now = new Date()
  const sequence = await context.store.incr(keys.sequence)
  const quote = quoteGenesis(config, 'GENESIS', chain)
  const hash = await genomeHash(config)
  let record: DeploymentRecord = {
    id,
    correlationId: context.correlationId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    enteredAt: now.toISOString(),
    state: 'DRAFT',
    tier: config.tier,
    config,
    genomeHash: hash,
    descendantId: descendantCode(sequence),
    burn: {
      chain,
      required: quote.total,
      mint: chain === 'base' ? context.env.base.token : context.env.config.mint,
      network: chain === 'base' ? context.env.base.network : context.env.config.network,
      memo: burnMemo(id),
      signature: null,
      receiptId: null,
    },
    history: [{ state: 'DRAFT', at: now.toISOString() }],
    error: null,
    version: 0,
  }
  record = transition(record, 'VALIDATED', now, 'Schema and policy validated on the server')
  record = transition(record, 'AWAITING_BURN', now, `Requires ${quote.total.toLocaleString('en-US')} QFORK`)
  await save(context, record)
  context.log.info('deployment created', { deploymentId: id, tier: record.tier, chain, descendant: record.descendantId })
  return { deployment: record, receipt: null }
}

export async function readDeployment(context: Context, id: string): Promise<PublicDeployment> {
  const record = await loadDeployment(context, id)
  const receipt = record.burn.signature ? await getJson<BurnReceipt>(context.store, keys.receipt(record.burn.signature)) : null
  return { deployment: record, receipt }
}

let mintCache: { mint: string; decimals: number; program: string; at: number } | null = null

async function mintInfo(context: Context, mint: string) {
  if (mintCache && mintCache.mint === mint && Date.now() - mintCache.at < 300_000) return mintCache
  const rpc = rpcClient(context.env.config.rpcUrl)
  const account = await rpc.getParsedAccount(mint).catch((error) => {
    throw rpcFailure(error)
  })
  const value = account?.value
  if (!value || (value.owner !== TOKEN_PROGRAM && value.owner !== TOKEN_2022_PROGRAM) || Array.isArray(value.data) || value.data.parsed?.type !== 'mint') {
    throw new HttpError(500, 'MINT_INVALID', 'The configured QFORK mint is not a token mint on this network.')
  }
  mintCache = { mint, decimals: Number(value.data.parsed.info.decimals), program: value.owner, at: Date.now() }
  return mintCache
}

export type BurnOutcome =
  | { status: 'PENDING'; deployment: DeploymentRecord }
  | { status: 'VERIFIED'; deployment: DeploymentRecord; receipt: BurnReceipt }
  | { status: 'FAILED'; deployment: DeploymentRecord; code: string; message: string; tokensBurned: boolean }

export async function submitBurn(context: Context, id: string, signature: string): Promise<BurnOutcome> {
  const existingReceipt = await getJson<BurnReceipt>(context.store, keys.receipt(signature))
  if (existingReceipt) {
    if (existingReceipt.deploymentId !== id) throw new HttpError(409, 'SIGNATURE_USED', 'This transaction is already bound to another deployment.')
    return { status: 'VERIFIED', deployment: (await readDeployment(context, id)).deployment, receipt: existingReceipt }
  }

  return withLock(context, id, async () => {
    let record = await loadDeployment(context, id)
    const chain = chainOf(record)
    requireLiveTier(context, record.tier, chain)
    if (chain === 'base') return submitBaseBurn(context, record, signature)
    if (!isSignature(signature)) throw new HttpError(400, 'INVALID_SIGNATURE', 'This deployment burns on Solana; send a Solana transaction signature.')
    if (record.burn.network !== context.env.config.network || record.burn.mint !== context.env.config.mint) {
      throw new HttpError(409, 'CONFIG_CHANGED', 'The network or mint changed since this deployment was created. Start a new deployment.')
    }

    const now = new Date()
    if (record.state === 'BURN_FAILED') record = transition(record, 'AWAITING_BURN', now, 'Retry requested')
    if (record.state === 'AWAITING_BURN') {
      record = transition({ ...record, burn: { ...record.burn, signature } }, 'BURN_SUBMITTED', now, 'Signature received; awaiting finality')
      await save(context, record)
    } else if (record.state !== 'BURN_SUBMITTED' || record.burn.signature !== signature) {
      throw new HttpError(409, 'BURN_ALREADY_BOUND', 'A different burn is already being verified for this deployment.')
    }

    const rpc = rpcClient(context.env.config.rpcUrl)
    const mint = await mintInfo(context, context.env.config.mint as string)
    let tx
    try {
      tx = await rpc.getParsedTransaction(signature, 'finalized')
    } catch (error) {
      throw rpcFailure(error)
    }

    if (!tx) {
      const status = await rpc.getSignatureStatus(signature).catch(() => null)
      if (status?.err) {
        record = transition({ ...record, error: { code: 'TX_FAILED', message: 'The transaction failed on-chain.' } }, 'BURN_FAILED', new Date(), 'Transaction failed; no tokens burned')
        await save(context, record)
        return { status: 'FAILED', deployment: record, code: 'TX_FAILED', message: 'The transaction failed on-chain. No QFORK was burned. It is safe to try again.', tokensBurned: false }
      }
      const submittedAt = new Date(record.enteredAt).getTime()
      if (!status && Date.now() - submittedAt > EXPIRY_MS) {
        record = transition({ ...record, error: { code: 'TX_EXPIRED', message: 'The transaction never landed.' } }, 'BURN_FAILED', new Date(), 'Transaction expired before landing')
        await save(context, record)
        return { status: 'FAILED', deployment: record, code: 'TX_EXPIRED', message: 'The transaction never reached the network and has expired. No QFORK was burned. It is safe to try again.', tokensBurned: false }
      }
      return { status: 'PENDING', deployment: record }
    }

    const verification = verifyBurnTransaction(tx, {
      mint: mint.mint,
      amountRaw: toBaseUnits(record.burn.required, mint.decimals),
      decimals: mint.decimals,
      memo: record.burn.memo,
    })

    if (!verification.ok) {
      const tokensBurned = verification.code !== 'TX_FAILED' && verification.code !== 'TX_NOT_FOUND' && verification.code !== 'NO_BURN'
      record = transition({ ...record, error: { code: verification.code, message: verification.message } }, 'BURN_FAILED', new Date(), `Verification failed: ${verification.code}`)
      await save(context, record)
      context.log.warn('burn rejected', { deploymentId: id, code: verification.code })
      return { status: 'FAILED', deployment: record, code: verification.code, message: verification.message, tokensBurned }
    }

    const claimed = await context.store.set(keys.burnLock(signature), id, { nx: true })
    if (!claimed && (await context.store.get(keys.burnLock(signature))) !== id) {
      throw new HttpError(409, 'SIGNATURE_USED', 'This transaction is already bound to another deployment.')
    }

    const verifiedAt = new Date()
    const receipt: BurnReceipt = {
      id: signature,
      wallet: verification.wallet,
      mint: mint.mint,
      amountRaw: toBaseUnits(record.burn.required, mint.decimals).toString(),
      decimals: mint.decimals,
      amount: record.burn.required,
      signature,
      slot: verification.slot,
      timestamp: verification.blockTime ? new Date(verification.blockTime * 1000).toISOString() : verifiedAt.toISOString(),
      purpose: 'GENESIS',
      ancestor: record.config.ancestor,
      descendantId: record.descendantId,
      deploymentId: record.id,
      network: context.env.config.network,
      chain: 'solana',
      tokenProgram: verification.tokenProgram,
      verificationStatus: 'VERIFIED',
      verifiedAt: verifiedAt.toISOString(),
      verifier: 'server',
    }
    await context.store.set(keys.receipt(signature), JSON.stringify(receipt))
    await context.store.incr(keys.burnedRaw(receipt.network), Number(receipt.amountRaw))
    await context.store.incr(keys.burnCount(receipt.network))
    return register(context, record, receipt, verifiedAt, 'Burn verified on-chain at finalized commitment')
  })
}

async function register(context: Context, input: DeploymentRecord, receipt: BurnReceipt, verifiedAt: Date, note: string): Promise<BurnOutcome> {
  let record = transition({ ...input, burn: { ...input.burn, receiptId: receipt.signature } }, 'BURN_CONFIRMED', verifiedAt, note)
  record = transition(record, 'REGISTERED', verifiedAt, `Registered as ${record.descendantId}`)
  await save(context, record)
  await context.store.lpush(keys.descendants, record.id)
  context.log.info('burn verified', { deploymentId: record.id, descendant: record.descendantId, chain: receipt.chain ?? 'solana', block: receipt.slot })
  return { status: 'VERIFIED', deployment: record, receipt }
}

/** A Base transaction that never shows up within this window is treated as dropped. */
const BASE_EXPIRY_MS = 600_000

async function submitBaseBurn(context: Context, input: DeploymentRecord, hash: string): Promise<BurnOutcome> {
  const { base } = context.env
  if (!isTxHash(hash)) throw new HttpError(400, 'INVALID_SIGNATURE', 'This deployment burns on Base; send a 0x transaction hash.')
  if (input.burn.network !== base.network || input.burn.mint !== base.token || !base.token) {
    throw new HttpError(409, 'CONFIG_CHANGED', 'The Base network or token changed since this deployment was created. Start a new deployment.')
  }
  let record = input
  const now = new Date()
  if (record.state === 'BURN_FAILED') record = transition(record, 'AWAITING_BURN', now, 'Retry requested')
  if (record.state === 'AWAITING_BURN') {
    record = transition({ ...record, burn: { ...record.burn, signature: hash } }, 'BURN_SUBMITTED', now, 'Transaction hash received; awaiting Base finality')
    await save(context, record)
  } else if (record.state !== 'BURN_SUBMITTED' || record.burn.signature !== hash) {
    throw new HttpError(409, 'BURN_ALREADY_BOUND', 'A different burn is already being verified for this deployment.')
  }

  const { tx, receipt, finalized } = await readBaseBurn(context, hash)
  const failed = async (code: string, message: string, note: string, tokensBurned = false): Promise<BurnOutcome> => {
    record = transition({ ...record, error: { code, message } }, 'BURN_FAILED', new Date(), note)
    await save(context, record)
    return { status: 'FAILED', deployment: record, code, message, tokensBurned }
  }

  if (!tx) {
    if (Date.now() - new Date(record.enteredAt).getTime() > BASE_EXPIRY_MS) {
      return failed('TX_EXPIRED', 'The transaction never reached Base. No QFORK was burned. It is safe to try again.', 'Transaction never landed')
    }
    return { status: 'PENDING', deployment: record }
  }
  if (!receipt) return { status: 'PENDING', deployment: record }
  if (receipt.status !== 'success') return failed('TX_FAILED', 'The transaction reverted on Base. No QFORK was burned. It is safe to try again.', 'Transaction reverted; no tokens burned')
  if (receipt.blockNumber > finalized) return { status: 'PENDING', deployment: record }

  const decimals = await baseTokenDecimals(context, base.token)
  const amountRaw = toBaseUnits(record.burn.required, decimals)
  const verification = verifyEvmBurn(tx, receipt, { token: base.token, amountRaw, tag: burnTag(record.burn.memo), chainId: base.chainId })
  if (!verification.ok) {
    context.log.warn('burn rejected', { deploymentId: record.id, chain: 'base', code: verification.code })
    return failed(verification.code, verification.message, `Verification failed: ${verification.code}`, burnedInReceipt(receipt, base.token))
  }

  const claimed = await context.store.set(keys.burnLock(hash), record.id, { nx: true })
  if (!claimed && (await context.store.get(keys.burnLock(hash))) !== record.id) {
    throw new HttpError(409, 'SIGNATURE_USED', 'This transaction is already bound to another deployment.')
  }

  const verifiedAt = new Date()
  const burnReceipt: BurnReceipt = {
    id: hash,
    wallet: verification.wallet,
    mint: base.token,
    amountRaw: amountRaw.toString(),
    decimals,
    amount: record.burn.required,
    signature: hash,
    slot: Number(verification.blockNumber),
    timestamp: verifiedAt.toISOString(),
    purpose: 'GENESIS',
    ancestor: record.config.ancestor,
    descendantId: record.descendantId,
    deploymentId: record.id,
    network: base.network,
    chain: 'base',
    tokenProgram: null,
    verificationStatus: 'VERIFIED',
    verifiedAt: verifiedAt.toISOString(),
    verifier: 'server',
  }
  await context.store.set(keys.receipt(hash), JSON.stringify(burnReceipt))
  await context.store.incr(keys.burnedWhole(base.network), record.burn.required)
  await context.store.incr(keys.burnCount(base.network))
  return register(context, record, burnReceipt, verifiedAt, 'Burn verified on Base at the finalized block')
}
