import { ed25519 } from '@noble/curves/ed25519'
import { associatedTokenAddress, base58Encode, metadataAddress } from '../../protocol/address'
import { type PreparedLaunch, type PumpSpec, signerIndex, SPL_MINT_SIZE, type SplSpec, supplyRaw, type TokenRecord, withSignature } from '../../protocol/tokens'
import { TOKEN_PROGRAM } from '../../protocol/verifyBurn'
import { api, ApiError } from '../api'
import { FlowError } from '../failures'
import { rpc } from './rpc'
import {
  compileLegacyMessage,
  computeUnitLimitInstruction,
  createAccountWithSeedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMetadataInstruction,
  fromBase64,
  initializeMint2Instruction,
  type Instruction,
  memoInstruction,
  messageOf,
  mintToCheckedInstruction,
  revokeMintAuthorityInstruction,
  sameBytes,
  toBase64,
  unsignedTransaction,
} from './tx'
import { signTransaction } from './wallet'

function asFlow(error: unknown, fallback: FlowError['code'] = 'API_UNAVAILABLE'): FlowError {
  if (error instanceof FlowError) return error
  if (error instanceof ApiError) return new FlowError(error.code.startsWith('RPC_') ? 'RPC_UNAVAILABLE' : fallback, error.message, { correlationId: error.correlationId })
  return new FlowError(fallback)
}

/* ---------- SPL (site cluster) ---------- */

export interface SplReview {
  kind: 'spl'
  prepared: PreparedLaunch
  spec: SplSpec
  memo: string
  account: string
  supplyRaw: bigint
  rentLamports: bigint
  feeLamports: bigint
  lamports: bigint
  instructions: string[]
  transaction: Uint8Array
  message: Uint8Array
  lastValidBlockHeight: number
}

function splInstructions(review: Pick<SplReview, 'prepared' | 'spec' | 'memo' | 'account' | 'supplyRaw' | 'rentLamports'>, owner: string): Instruction[] {
  const { prepared, spec } = review
  const mint = prepared.mint
  const list: Instruction[] = [
    computeUnitLimitInstruction(220_000),
    createAccountWithSeedInstruction({ payer: owner, account: mint, seed: prepared.seed as string, lamports: review.rentLamports, space: SPL_MINT_SIZE, owner: TOKEN_PROGRAM }),
    initializeMint2Instruction({ tokenProgram: TOKEN_PROGRAM, mint, decimals: spec.decimals, mintAuthority: owner }),
    createAssociatedTokenAccountIdempotentInstruction({ payer: owner, account: review.account, owner, mint, tokenProgram: TOKEN_PROGRAM }),
    mintToCheckedInstruction({ tokenProgram: TOKEN_PROGRAM, mint, destination: review.account, authority: owner, amount: review.supplyRaw, decimals: spec.decimals }),
    createMetadataInstruction({ metadata: metadataAddress(mint), mint, authority: owner, name: spec.name, symbol: spec.symbol, uri: prepared.uri, mutable: false }),
  ]
  if (spec.fixedSupply) list.push(revokeMintAuthorityInstruction({ tokenProgram: TOKEN_PROGRAM, mint, authority: owner }))
  list.push(memoInstruction(review.memo, owner))
  return list
}

const SPL_STEPS = (spec: SplSpec) => [
  'Create the mint account (its address is derived from your wallet)',
  `Initialize the mint: ${spec.decimals} decimals, you as mint authority, no freeze authority`,
  'Create your token account',
  `Mint ${BigInt(spec.supply).toLocaleString('en-US')} ${spec.symbol} to your token account`,
  `Write on-chain metadata: name “${spec.name}”, symbol ${spec.symbol}, immutable`,
  ...(spec.fixedSupply ? ['Revoke the mint authority: the supply can never grow'] : []),
  'Memo binding the token to this descendant',
]

async function buildSpl(prepared: PreparedLaunch, spec: SplSpec, memo: string, owner: string): Promise<SplReview> {
  const raw = supplyRaw(spec)
  const account = associatedTokenAddress(owner, prepared.mint, TOKEN_PROGRAM)
  const [rentLamports, lamports, latest] = await Promise.all([rpc.getMinimumBalanceForRentExemption(SPL_MINT_SIZE), rpc.getBalance(owner), rpc.getLatestBlockhash()])
  const base = { prepared, spec, memo, account, supplyRaw: raw, rentLamports }
  const message = compileLegacyMessage(owner, splInstructions(base, owner), latest.blockhash)
  const transaction = unsignedTransaction(message)
  const feeLamports = (await rpc.getFeeForMessage(toBase64(message)).catch(() => null)) ?? 10_000n
  return { kind: 'spl', ...base, feeLamports, lamports, instructions: SPL_STEPS(spec), transaction, message, lastValidBlockHeight: latest.lastValidBlockHeight }
}

/** Reserves a mint and metadata on the server, builds the exact transaction and dry-runs it. Nothing is signed. */
export async function prepareSplLaunch(deploymentId: string, owner: string, spec: SplSpec): Promise<SplReview> {
  let data: { prepared: PreparedLaunch; memo: string }
  try {
    data = (await api<{ prepared: PreparedLaunch; memo: string }>('/api/tokens', { method: 'POST', body: { action: 'prepare-spl', deploymentId, wallet: owner, spec } })).data
  } catch (error) {
    throw asFlow(error)
  }
  const review = await buildSpl(data.prepared, spec, data.memo, owner)
  const simulation = await rpc.simulate(toBase64(review.transaction))
  if (simulation.err !== null) {
    const logs = simulation.logs ?? []
    if (logs.some((line) => /insufficient (lamports|funds)/i.test(line))) throw new FlowError('INSUFFICIENT_SOL', 'The wallet cannot pay for the mint, token account and metadata rent.')
    throw new FlowError('SIMULATION_FAILED', 'The dry run failed. Nothing was sent.', { logs: logs.slice(-12) })
  }
  return review
}

/** Rebuilds with a fresh blockhash, signs, refuses an altered transaction, sends. */
export async function sendSplLaunch(review: SplReview, owner: string): Promise<string> {
  const fresh = await buildSpl(review.prepared, review.spec, review.memo, owner)
  const signed = await signTransaction(fresh.transaction)
  if (!sameBytes(messageOf(signed), fresh.message)) throw new FlowError('TX_MODIFIED')
  try {
    return await rpc.send(toBase64(signed))
  } catch (error) {
    if (error instanceof FlowError) throw error
    throw new FlowError('SIMULATION_FAILED', (error as Error).message)
  }
}

/* ---------- Pump.fun (mainnet) ---------- */

export interface PumpReview {
  kind: 'pumpfun'
  prepared: PreparedLaunch
  spec: PumpSpec
  transaction: Uint8Array
  /** Held in memory for this launch only. Never stored, logged or sent anywhere. */
  mintSecret: Uint8Array
}

export async function preparePumpLaunch(deploymentId: string, owner: string, spec: PumpSpec): Promise<PumpReview> {
  const mintSecret = ed25519.utils.randomPrivateKey()
  const mint = base58Encode(ed25519.getPublicKey(mintSecret))
  let data: { prepared: PreparedLaunch; transaction: string }
  try {
    data = (await api<{ prepared: PreparedLaunch; transaction: string }>('/api/tokens', { method: 'POST', body: { action: 'prepare-pumpfun', deploymentId, wallet: owner, mint, spec }, timeoutMs: 25_000 })).data
  } catch (error) {
    throw asFlow(error)
  }
  return { kind: 'pumpfun', prepared: data.prepared, spec, transaction: fromBase64(data.transaction), mintSecret }
}

/** Wallet signs on mainnet first, then the fresh mint key co-signs the exact same message, then the server relays it. */
export async function sendPumpLaunch(review: PumpReview): Promise<string> {
  const signed = await signTransaction(review.transaction, 'solana:mainnet')
  const message = messageOf(signed)
  if (!sameBytes(message, messageOf(review.transaction))) throw new FlowError('TX_MODIFIED')
  const index = signerIndex(signed, review.prepared.mint)
  if (index < 0) throw new FlowError('SIMULATION_FAILED', 'The mint is not a signer of this transaction.')
  const complete = withSignature(signed, index, ed25519.sign(message, review.mintSecret))
  review.mintSecret.fill(0)
  try {
    const { data } = await api<{ signature: string }>('/api/tokens', { method: 'POST', body: { action: 'relay', mint: review.prepared.mint, transaction: toBase64(complete) }, timeoutMs: 30_000 })
    return data.signature
  } catch (error) {
    if (error instanceof ApiError && error.code === 'TX_REJECTED') {
      throw new FlowError(/insufficient/i.test(error.message) ? 'INSUFFICIENT_SOL' : 'SIMULATION_FAILED', error.message)
    }
    throw asFlow(error)
  }
}

/* ---------- verification ---------- */

type Outcome = { status: 'PENDING' } | { status: 'VERIFIED'; token: TokenRecord } | { status: 'FAILED'; code: string; message: string }

/** Polls the server until it has read the creation transaction from the chain. */
export async function verifyLaunch(mint: string, signature: string, signal?: AbortSignal): Promise<TokenRecord> {
  let transient = 0
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const { data } = await api<Outcome>('/api/tokens', { method: 'POST', body: { action: 'verify', mint, signature }, accept: [202, 422], timeoutMs: 25_000 })
      transient = 0
      if (data.status === 'VERIFIED') return data.token
      if (data.status === 'FAILED') throw new FlowError(data.code === 'TX_FAILED' ? 'TOKEN_FAILED' : 'TOKEN_NOT_RECORDED', data.message, { signature })
    } catch (error) {
      if (error instanceof FlowError) throw error
      transient += 1
      if (transient > 6) throw new FlowError('TOKEN_NOT_RECORDED', 'The server could not be reached to verify the token.', { signature })
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2500))
  }
  throw new FlowError('TOKEN_NOT_RECORDED', 'The transaction has not been confirmed yet.', { signature })
}

/* ---------- faucet ---------- */

export async function claimFaucet(wallet: string): Promise<{ signature: string; amount: number; solTopUp: number }> {
  try {
    const { data } = await api<{ signature: string; amount: number; solTopUp: number; lastValidBlockHeight: number }>('/api/faucet', { method: 'POST', body: { wallet }, timeoutMs: 25_000 })
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await rpc.getSignatureStatus(data.signature).catch(() => undefined)
      if (status?.err) throw new FlowError('FAUCET_FAILED', 'The faucet transaction failed on-chain.')
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') break
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
    }
    return data
  } catch (error) {
    if (error instanceof FlowError) throw error
    if (error instanceof ApiError) throw new FlowError('FAUCET_FAILED', error.message, { correlationId: error.correlationId })
    throw new FlowError('FAUCET_FAILED')
  }
}
