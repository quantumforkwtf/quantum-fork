import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../../protocol/verifyBurn'
import { FlowError } from '../failures'
import { rpc } from './rpc'
import { buildBurnTransaction, firstSignature, messageOf, sameBytes, toBase64 } from './tx'
import { signTransaction } from './wallet'

export interface BurnRequest {
  owner: string
  mint: string
  /** Whole QFORK required, as returned by the server for this deployment. */
  amount: number
  memo: string
}

export interface PreparedBurn {
  request: BurnRequest
  tokenProgram: string
  tokenAccount: string
  decimals: number
  amountRaw: bigint
  balanceRaw: bigint
  lamports: bigint
  feeLamports: bigint
  blockhash: string
  lastValidBlockHeight: number
  transaction: Uint8Array
  message: Uint8Array
  simulation: { ok: boolean; logs: string[]; unitsConsumed: number | null }
}

const FEE_FALLBACK = 10_000n

/** Reads chain state, builds the exact transaction, and simulates it. Nothing is signed. */
export async function prepareBurn(request: BurnRequest): Promise<PreparedBurn> {
  const mint = await rpc.getMint(request.mint)
  if (!mint || (mint.tokenProgram !== TOKEN_PROGRAM && mint.tokenProgram !== TOKEN_2022_PROGRAM)) {
    throw new FlowError('SIMULATION_FAILED', 'The configured QFORK mint does not exist on this network.')
  }
  const amountRaw = BigInt(request.amount) * 10n ** BigInt(mint.decimals)
  const [holdings, lamports, latest] = await Promise.all([rpc.getHoldings(request.owner, request.mint), rpc.getBalance(request.owner), rpc.getLatestBlockhash()])
  const account = holdings.find((holding) => !holding.frozen && holding.amountRaw >= amountRaw)
  if (!account) {
    const total = holdings.reduce((sum, holding) => sum + holding.amountRaw, 0n)
    throw new FlowError('INSUFFICIENT_QFORK', `Requires ${request.amount.toLocaleString('en-US')} QFORK in one token account. Wallet holds ${(Number(total) / 10 ** mint.decimals).toLocaleString('en-US')}.`)
  }

  const built = buildBurnTransaction({
    owner: request.owner,
    tokenAccount: account.address,
    mint: request.mint,
    tokenProgram: mint.tokenProgram,
    amountRaw,
    decimals: mint.decimals,
    memo: request.memo,
    recentBlockhash: latest.blockhash,
  })

  const feeLamports = (await rpc.getFeeForMessage(toBase64(built.message)).catch(() => null)) ?? FEE_FALLBACK
  if (lamports < feeLamports) throw new FlowError('INSUFFICIENT_SOL', `The fee is about ${Number(feeLamports) / 1e9} SOL; the wallet holds ${Number(lamports) / 1e9} SOL.`)

  const simulation = await rpc.simulate(toBase64(built.transaction))
  const prepared: PreparedBurn = {
    request,
    tokenProgram: mint.tokenProgram,
    tokenAccount: account.address,
    decimals: mint.decimals,
    amountRaw,
    balanceRaw: account.amountRaw,
    lamports,
    feeLamports,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    transaction: built.transaction,
    message: built.message,
    simulation: { ok: simulation.err === null, logs: simulation.logs ?? [], unitsConsumed: simulation.unitsConsumed ?? null },
  }
  if (!prepared.simulation.ok) throw new FlowError('SIMULATION_FAILED', 'The dry run failed. The transaction was not sent.', { logs: prepared.simulation.logs.slice(-12) })
  return prepared
}

/**
 * Rebuilds with a fresh blockhash, asks the wallet to sign, refuses any
 * transaction the wallet altered, then broadcasts. Returns the signature.
 * `onSigned` runs before broadcasting so the signature survives a reload.
 */
export async function signAndSend(review: PreparedBurn, onSigned: (signature: string) => void): Promise<{ signature: string; lastValidBlockHeight: number }> {
  const fresh = await prepareBurn(review.request)
  if (fresh.tokenAccount !== review.tokenAccount || fresh.amountRaw !== review.amountRaw || fresh.tokenProgram !== review.tokenProgram) {
    throw new FlowError('SIMULATION_FAILED', 'Chain state changed since review. Review the transaction again.')
  }
  const signed = await signTransaction(fresh.transaction)
  if (!sameBytes(messageOf(signed), fresh.message)) throw new FlowError('TX_MODIFIED')
  const signature = firstSignature(signed)
  if (!signature) throw new FlowError('WALLET_REJECTED', 'The wallet returned an unsigned transaction.')
  onSigned(signature)
  try {
    await rpc.send(toBase64(signed))
  } catch (error) {
    if (error instanceof FlowError) throw new FlowError(error.code, error.detail, { signature })
    // Preflight rejection. The transaction never reached a leader.
    throw new FlowError('SIMULATION_FAILED', (error as Error).message, { signature })
  }
  return { signature, lastValidBlockHeight: fresh.lastValidBlockHeight }
}

/** Waits for confirmed commitment or blockhash expiry. Finality is checked by the server. */
export async function awaitConfirmation(signature: string, lastValidBlockHeight: number, signal?: AbortSignal) {
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const status = await rpc.getSignatureStatus(signature).catch(() => undefined)
    if (status?.err) throw new FlowError('BURN_FAILED', 'The transaction failed on-chain.', { signature })
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return status.confirmationStatus
    if (status === null) {
      const height = await rpc.getBlockHeight().catch(() => 0)
      if (height > lastValidBlockHeight) throw new FlowError('TX_EXPIRED', undefined, { signature })
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500))
  }
}
