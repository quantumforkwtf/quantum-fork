import { encodeFunctionData, getAddress, type Hex } from 'viem'
import { base58Decode, createWithSeed, metadataAddress } from '../../src/protocol/address.js'
import type { AncestorId } from '../../src/protocol/ancestors.js'
import type { Chain } from '../../src/protocol/base.js'
import { CLANKER_DECIMALS, CLANKER_FACTORY, CLANKER_SUPPLY_RAW, clankerContext, verifyClankerCreation } from '../../src/protocol/clanker.js'
import { PUMP_PROGRAM_ID } from '../../src/protocol/pumpfun.js'
import type { BurnReceipt } from '../../src/protocol/receipt.js'
import {
  type ClankerSpec,
  decodeMetadataAccount,
  type PreparedClanker,
  type PreparedLaunch,
  type PumpSpec,
  signerIndex,
  type SplSpec,
  type TokenCluster,
  type TokenKind,
  type TokenMetadataJson,
  tokenMemo,
  type TokenRecord,
  tokenSeed,
  verifyPumpCreation,
  verifySplCreation,
} from '../../src/protocol/tokens.js'
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../../src/protocol/verifyBurn.js'
import { fromBase64 } from '../../src/lib/solana/tx.js'
import { loadDeployment } from './deployments.js'
import { readBaseBurn } from './evm.js'
import { type Context, HttpError, randomToken } from './http.js'
import { RpcError, rpcClient, rpcFailure } from './rpc.js'
import { getJson, keys } from './store.js'

const PREPARE_TTL = 3600
/** Base finality takes minutes and the token image is served from this record, so it outlives a closed tab. */
const CLANKER_TTL = 7 * 86400
const MAX_TOKENS_PER_DESCENDANT = 12
const PUMPPORTAL = 'https://pumpportal.fun/api/trade-local'

function clusterRpc(context: Context, cluster: TokenCluster) {
  return rpcClient(cluster === 'mainnet-beta' ? context.env.mainnetRpcUrl : context.env.config.rpcUrl, 10_000)
}

/** The descendant must be registered on this chain, and only the wallet that burned for it can launch its tokens. */
async function ownedDescendant(context: Context, deploymentId: string, wallet: string, chain: Chain = 'solana') {
  const record = await loadDeployment(context, deploymentId)
  if (record.state !== 'REGISTERED' || !record.burn.receiptId) throw new HttpError(409, 'NOT_REGISTERED', 'This descendant is not registered yet.')
  const receipt = await getJson<BurnReceipt>(context.store, keys.receipt(record.burn.receiptId))
  if (!receipt) throw new HttpError(409, 'NOT_REGISTERED', 'This descendant has no verified burn receipt.')
  if ((receipt.chain ?? 'solana') !== chain) throw new HttpError(409, 'WRONG_CHAIN', `This descendant was registered on ${receipt.chain === 'base' ? 'Base' : 'Solana'}; its tokens launch there.`)
  const owner = chain === 'base' ? receipt.wallet.toLowerCase() === wallet.toLowerCase() : receipt.wallet === wallet
  if (!owner) throw new HttpError(403, 'NOT_OWNER', 'Only the wallet that burned for this descendant can launch its tokens.')
  const count = (await context.store.lrange(keys.tokensOf(record.id), 0, MAX_TOKENS_PER_DESCENDANT)).length
  if (count >= MAX_TOKENS_PER_DESCENDANT) throw new HttpError(409, 'TOKEN_LIMIT', `A descendant can launch up to ${MAX_TOKENS_PER_DESCENDANT} tokens.`)
  return record
}

const ancestorName = (ancestor: AncestorId) => (ancestor === 'base' ? 'Base' : 'Solana')

function metadataFor(context: Context, mint: string, descendantId: string, deploymentId: string, ancestor: AncestorId, spec: { name: string; symbol: string; description: string }): TokenMetadataJson {
  const site = context.env.config.siteUrl
  return {
    name: spec.name,
    symbol: spec.symbol,
    description: spec.description || `${spec.name} ($${spec.symbol}), launched for ${descendantId}, a Quantum Fork descendant of ${ancestorName(ancestor)}.`,
    image: `${site}/api/og?token=${mint}`,
    external_url: `${site}/species/${deploymentId}`,
    attributes: [
      { trait_type: 'Descendant', value: descendantId },
      { trait_type: 'Ancestor', value: ancestorName(ancestor) },
    ],
  }
}

async function savePrepared(context: Context, prepared: PreparedLaunch) {
  const claimed = await context.store.set(keys.launch(prepared.mint), JSON.stringify(prepared), { nx: true, ttlSeconds: PREPARE_TTL })
  if (!claimed) throw new HttpError(409, 'MINT_TAKEN', 'This mint address is already being launched. Start again.')
  await context.store.set(keys.meta(prepared.mint), JSON.stringify(prepared.metadata), { ttlSeconds: PREPARE_TTL })
}

export async function prepareSpl(context: Context, input: { deploymentId: string; wallet: string; spec: SplSpec }) {
  const record = await ownedDescendant(context, input.deploymentId, input.wallet)
  const cluster = context.env.config.network
  const seed = tokenSeed(() => randomToken(10))
  const mint = createWithSeed(input.wallet, seed, TOKEN_PROGRAM)
  const metadata = metadataFor(context, mint, record.descendantId, record.id, record.config.ancestor, input.spec)
  const prepared: PreparedLaunch = {
    mint,
    kind: 'spl',
    cluster,
    deploymentId: record.id,
    descendantId: record.descendantId,
    wallet: input.wallet,
    seed,
    metadata,
    uri: `${context.env.config.siteUrl}/api/tokens?meta=${mint}`,
    createdAt: new Date().toISOString(),
  }
  await savePrepared(context, prepared)
  context.log.info('spl launch prepared', { deploymentId: record.id, mint })
  return { prepared, memo: tokenMemo(record.id) }
}

/** Asks PumpPortal for the unsigned create transaction. The mint keypair is generated in the browser and never leaves it. */
export async function preparePump(context: Context, input: { deploymentId: string; wallet: string; mint: string; spec: PumpSpec }) {
  if (!context.env.config.flags.pumpfunLaunch) throw new HttpError(403, 'PUMPFUN_DISABLED', 'Pump.fun launches are switched off on this server (ENABLE_PUMPFUN_LAUNCH).')
  const record = await ownedDescendant(context, input.deploymentId, input.wallet)
  const metadata = metadataFor(context, input.mint, record.descendantId, record.id, record.config.ancestor, input.spec)
  const uri = `${context.env.config.siteUrl}/api/tokens?meta=${input.mint}`
  const prepared: PreparedLaunch = {
    mint: input.mint,
    kind: 'pumpfun',
    cluster: 'mainnet-beta',
    deploymentId: record.id,
    descendantId: record.descendantId,
    wallet: input.wallet,
    seed: null,
    metadata,
    uri,
    createdAt: new Date().toISOString(),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  let bytes: Uint8Array
  try {
    const response = await fetch(PUMPPORTAL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: input.wallet,
        action: 'create',
        tokenMetadata: { name: input.spec.name, symbol: input.spec.symbol, uri },
        mint: input.mint,
        denominatedInSol: 'true',
        amount: input.spec.devBuySol,
        slippage: 10,
        priorityFee: 0.00005,
        pool: 'pump',
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new HttpError(502, 'PUMPPORTAL_REJECTED', `PumpPortal could not build the transaction (${response.status}). Nothing was signed.`)
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(503, 'PUMPPORTAL_UNAVAILABLE', 'PumpPortal did not respond. Nothing was signed; it is safe to retry.')
  } finally {
    clearTimeout(timer)
  }

  assertPumpCreate(bytes, input.wallet, input.mint)
  await savePrepared(context, prepared)
  context.log.info('pump launch prepared', { deploymentId: record.id, mint: input.mint })
  return { prepared, transaction: Buffer.from(bytes).toString('base64') }
}

/** The transaction must be paid by the owner, signed by the fresh mint, and call the Pump program. */
function assertPumpCreate(bytes: Uint8Array, wallet: string, mint: string) {
  let ok = false
  try {
    const pump = base58Decode(PUMP_PROGRAM_ID)
    const hasPump = (() => {
      for (let start = 0; start + 32 <= bytes.length; start += 1) if (pump.every((byte, index) => bytes[start + index] === byte)) return true
      return false
    })()
    ok = signerIndex(bytes, wallet) === 0 && signerIndex(bytes, mint) > 0 && hasPump
  } catch {
    ok = false
  }
  if (!ok) throw new HttpError(502, 'PUMPPORTAL_UNEXPECTED', 'PumpPortal returned a transaction that does not match the launch. Nothing was signed.')
}

/** Broadcasts a signed Pump.fun create to mainnet. Only transactions this server prepared are relayed. */
export async function relayPump(context: Context, input: { mint: string; transaction: string }) {
  const prepared = await getJson<PreparedLaunch>(context.store, keys.launch(input.mint))
  if (!prepared || prepared.kind !== 'pumpfun') throw new HttpError(404, 'NOT_PREPARED', 'No Pump.fun launch was prepared for this mint, or it expired. Start again.')
  const bytes = fromBase64(input.transaction)
  assertPumpCreate(bytes, prepared.wallet, prepared.mint)
  try {
    const signature = await clusterRpc(context, 'mainnet-beta').sendTransaction(input.transaction)
    context.log.info('pump launch relayed', { mint: prepared.mint })
    return { signature }
  } catch (error) {
    if (error instanceof RpcError && error.code === 'RPC_ERROR') {
      throw new HttpError(422, 'TX_REJECTED', `Mainnet rejected the transaction: ${error.message.slice(0, 200)}`)
    }
    throw rpcFailure(error)
  }
}

async function readMintState(context: Context, cluster: TokenCluster, mint: string) {
  const rpc = clusterRpc(context, cluster)
  const account = (await rpc.getParsedAccount(mint)).value
  if (!account || (account.owner !== TOKEN_PROGRAM && account.owner !== TOKEN_2022_PROGRAM) || Array.isArray(account.data) || account.data.parsed?.type !== 'mint') return null
  const info = account.data.parsed.info as { decimals: number; supply: string; mintAuthority?: string | null; extensions?: { extension: string; state: { name?: string; symbol?: string; uri?: string } }[] }
  let onChain: { name: string; symbol: string; uri: string } | null = null
  const extension = info.extensions?.find((item) => item.extension === 'tokenMetadata')
  if (extension?.state.name) onChain = { name: extension.state.name, symbol: extension.state.symbol ?? '', uri: extension.state.uri ?? '' }
  if (!onChain) {
    const raw = (await rpc.getRawAccount(metadataAddress(mint)).catch(() => null))?.value
    const decoded = raw ? decodeMetadataAccount(fromBase64(raw.data[0])) : null
    if (decoded && decoded.mint === mint) onChain = decoded
  }
  return { tokenProgram: account.owner, decimals: Number(info.decimals), supplyRaw: String(info.supply), mintAuthority: info.mintAuthority ?? null, metadata: onChain }
}

export type LaunchOutcome = { status: 'PENDING' } | { status: 'VERIFIED'; token: TokenRecord } | { status: 'FAILED'; code: string; message: string }

/** Reads the creation transaction and mint from the chain; records the token only if both check out. */
export async function verifyLaunch(context: Context, input: { mint: string; signature: string }): Promise<LaunchOutcome> {
  const existing = await getJson<TokenRecord>(context.store, keys.token(input.mint))
  if (existing) return { status: 'VERIFIED', token: existing }
  const prepared = await getJson<PreparedLaunch>(context.store, keys.launch(input.mint))
  if (!prepared) throw new HttpError(404, 'NOT_PREPARED', 'No launch was prepared for this mint, or it expired.')

  const rpc = clusterRpc(context, prepared.cluster)
  let tx
  try {
    tx = await rpc.getParsedTransaction(input.signature, 'confirmed')
  } catch (error) {
    throw rpcFailure(error)
  }
  if (!tx) {
    const status = await rpc.getSignatureStatus(input.signature).catch(() => null)
    if (status?.err) return { status: 'FAILED', code: 'TX_FAILED', message: 'The transaction failed on-chain. No token was created.' }
    return { status: 'PENDING' }
  }

  const verification =
    prepared.kind === 'spl'
      ? verifySplCreation(tx, { mint: prepared.mint, owner: prepared.wallet, memo: tokenMemo(prepared.deploymentId) })
      : verifyPumpCreation(tx, { mint: prepared.mint, owner: prepared.wallet })
  if (!verification.ok) {
    context.log.warn('token rejected', { mint: prepared.mint, code: verification.code })
    return { status: 'FAILED', code: verification.code, message: verification.message }
  }

  let state
  try {
    state = await readMintState(context, prepared.cluster, prepared.mint)
  } catch (error) {
    throw rpcFailure(error)
  }
  if (!state) return { status: 'PENDING' }

  const now = new Date().toISOString()
  const token: TokenRecord = {
    mint: prepared.mint,
    kind: prepared.kind as TokenKind,
    cluster: prepared.cluster,
    deploymentId: prepared.deploymentId,
    descendantId: prepared.descendantId,
    name: state.metadata?.name || prepared.metadata.name,
    symbol: state.metadata?.symbol || prepared.metadata.symbol,
    decimals: state.decimals,
    supplyRaw: state.supplyRaw,
    mintAuthority: state.mintAuthority,
    tokenProgram: state.tokenProgram,
    uri: state.metadata?.uri ?? prepared.uri,
    creator: verification.creator,
    signature: input.signature,
    slot: verification.slot,
    createdAt: verification.blockTime ? new Date(verification.blockTime * 1000).toISOString() : now,
    verifiedAt: now,
  }
  const claimed = await context.store.set(keys.token(token.mint), JSON.stringify(token), { nx: true })
  if (!claimed) return { status: 'VERIFIED', token: (await getJson<TokenRecord>(context.store, keys.token(token.mint))) ?? token }
  await context.store.persist(keys.meta(token.mint))
  await context.store.lpush(keys.tokensOf(token.deploymentId), token.mint)
  await context.store.lpush(keys.tokens, token.mint)
  context.log.info('token verified', { deploymentId: token.deploymentId, mint: token.mint, kind: token.kind })
  return { status: 'VERIFIED', token }
}

/**
 * Builds the Clanker v4 deployToken transaction for the descendant's owner. LP rewards go to the
 * owner; the context field, which Clanker makes immutable, names this descendant.
 */
export async function prepareClanker(context: Context, input: { deploymentId: string; wallet: string; spec: ClankerSpec }) {
  const base = context.env.base
  if (!base.clankerLaunch) throw new HttpError(403, 'CLANKER_DISABLED', 'Clanker launches are switched off on this server (ENABLE_CLANKER_LAUNCH).')
  const record = await ownedDescendant(context, input.deploymentId, input.wallet, 'base')
  if (record.burn.network !== base.network) throw new HttpError(409, 'WRONG_NETWORK', `This descendant was registered on ${record.burn.network}; this server launches on ${base.network}.`)
  const owner = getAddress(input.wallet)
  const launchId = `clk_${randomToken(16)}`
  const site = context.env.config.siteUrl
  const image = `${site}/api/og?token=${launchId}`
  const description = input.spec.description || `${input.spec.name} ($${input.spec.symbol}), launched for ${record.descendantId}, a Quantum Fork descendant.`

  const { Clanker } = await import('clanker-sdk/v4')
  const built = await new Clanker({}).getDeployTransaction({
    name: input.spec.name,
    symbol: input.spec.symbol,
    tokenAdmin: owner,
    chainId: base.chainId as 8453 | 84532,
    image,
    salt: `0x${randomToken(32)}`,
    metadata: { description },
    context: clankerContext(record.id, record.descendantId),
  })
  const config = built.args[0] as { lockerConfig: { rewardRecipients: readonly string[]; rewardAdmins: readonly string[] }; poolConfig: { pairedToken: string } }
  const expected = [config.lockerConfig.rewardRecipients, config.lockerConfig.rewardAdmins].every((list) => list.length > 0 && list.every((item) => getAddress(item) === owner))
  if (getAddress(built.address) !== CLANKER_FACTORY || (built.value ?? 0n) !== 0n || !expected) {
    throw new HttpError(502, 'CLANKER_UNEXPECTED', 'The Clanker transaction did not match the expected factory, value or reward recipient. Nothing was signed.')
  }
  const prepared: PreparedClanker = {
    launchId,
    kind: 'clanker',
    cluster: base.network,
    chainId: base.chainId,
    deploymentId: record.id,
    descendantId: record.descendantId,
    wallet: owner,
    spec: input.spec,
    to: CLANKER_FACTORY,
    data: encodeFunctionData({ abi: built.abi, functionName: built.functionName, args: built.args }),
    image,
    pairedToken: getAddress(config.poolConfig.pairedToken),
    rewardRecipient: owner,
    createdAt: new Date().toISOString(),
  }
  const metadata: TokenMetadataJson = {
    name: input.spec.name,
    symbol: input.spec.symbol,
    description,
    image,
    external_url: `${site}/species/${record.id}`,
    attributes: [
      { trait_type: 'Descendant', value: record.descendantId },
      { trait_type: 'Ancestor', value: ancestorName(record.config.ancestor) },
    ],
  }
  await context.store.set(keys.launch(launchId), JSON.stringify(prepared), { nx: true, ttlSeconds: CLANKER_TTL })
  await context.store.set(keys.meta(launchId), JSON.stringify(metadata), { ttlSeconds: CLANKER_TTL })
  context.log.info('clanker launch prepared', { deploymentId: record.id, launchId })
  return { prepared }
}

/** Reads the deployToken transaction from Base; records the token only if it matches what was prepared. */
export async function verifyClanker(context: Context, input: { launchId: string; hash: string }): Promise<LaunchOutcome> {
  const prepared = await getJson<PreparedClanker>(context.store, keys.launch(input.launchId))
  if (!prepared || prepared.kind !== 'clanker') throw new HttpError(404, 'NOT_PREPARED', 'No Clanker launch was prepared with this id, or it expired.')
  if (prepared.cluster !== context.env.base.network) return { status: 'FAILED', code: 'WRONG_NETWORK', message: 'This launch was prepared for a different Base network.' }

  const { tx, receipt, finalized } = await readBaseBurn(context, input.hash as Hex)
  const verification = verifyClankerCreation(tx, receipt, { chainId: prepared.chainId, owner: prepared.wallet as Hex, data: prepared.data as Hex, deploymentId: prepared.deploymentId })
  if (!verification.ok) {
    if (verification.code === 'TX_NOT_FOUND') return { status: 'PENDING' }
    context.log.warn('clanker token rejected', { launchId: prepared.launchId, code: verification.code })
    return { status: 'FAILED', code: verification.code, message: verification.message }
  }
  if (verification.blockNumber > finalized) return { status: 'PENDING' }

  const existing = await getJson<TokenRecord>(context.store, keys.token(verification.token))
  if (existing) return { status: 'VERIFIED', token: existing }
  const now = new Date().toISOString()
  const token: TokenRecord = {
    mint: verification.token,
    kind: 'clanker',
    cluster: prepared.cluster,
    deploymentId: prepared.deploymentId,
    descendantId: prepared.descendantId,
    name: verification.name,
    symbol: verification.symbol,
    decimals: CLANKER_DECIMALS,
    supplyRaw: CLANKER_SUPPLY_RAW.toString(),
    mintAuthority: null,
    tokenProgram: 'Clanker v4 ERC-20',
    uri: prepared.image,
    creator: prepared.wallet,
    signature: input.hash,
    slot: Number(verification.blockNumber),
    createdAt: now,
    verifiedAt: now,
  }
  const claimed = await context.store.set(keys.token(token.mint), JSON.stringify(token), { nx: true })
  if (!claimed) return { status: 'VERIFIED', token: (await getJson<TokenRecord>(context.store, keys.token(token.mint))) ?? token }
  await context.store.persist(keys.meta(prepared.launchId))
  await context.store.lpush(keys.tokensOf(token.deploymentId), token.mint)
  await context.store.lpush(keys.tokens, token.mint)
  context.log.info('clanker token verified', { deploymentId: token.deploymentId, token: token.mint })
  return { status: 'VERIFIED', token }
}

export async function tokensOf(context: Context, deploymentId: string): Promise<TokenRecord[]> {
  const mints = await context.store.lrange(keys.tokensOf(deploymentId), 0, MAX_TOKENS_PER_DESCENDANT)
  const records = await Promise.all(mints.map((mint) => getJson<TokenRecord>(context.store, keys.token(mint))))
  return records.filter((record): record is TokenRecord => record !== null)
}
