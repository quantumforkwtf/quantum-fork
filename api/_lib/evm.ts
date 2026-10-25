import { createPublicClient, type Hex, http, TransactionNotFoundError, TransactionReceiptNotFoundError } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { ERC20_BURN_ABI, type EvmReceipt, type EvmTx } from '../../src/protocol/base.js'
import type { Context } from './http.js'
import { HttpError } from './http.js'

function client(context: Context) {
  const chain = context.env.base.network === 'base' ? base : baseSepolia
  return createPublicClient({ chain, transport: http(context.env.baseRpcUrl, { timeout: 10_000, retryCount: 1 }) })
}

export function evmFailure(error: unknown) {
  return new HttpError(502, 'RPC_UNAVAILABLE', 'The Base RPC did not answer. Nothing was recorded; retry in a moment.', { cause: (error as Error)?.name })
}

const missing = (error: unknown) => error instanceof TransactionNotFoundError || error instanceof TransactionReceiptNotFoundError

/** The transaction, its receipt, and the latest finalized block. Null fields mean "not found yet". */
export async function readBaseBurn(context: Context, hash: Hex): Promise<{ tx: EvmTx | null; receipt: EvmReceipt | null; finalized: bigint }> {
  const rpc = client(context)
  try {
    const [tx, receipt, finalized] = await Promise.all([
      rpc.getTransaction({ hash }).catch((error) => (missing(error) ? null : Promise.reject(error))),
      rpc.getTransactionReceipt({ hash }).catch((error) => (missing(error) ? null : Promise.reject(error))),
      rpc.getBlock({ blockTag: 'finalized' }),
    ])
    return {
      tx: tx ? { hash: tx.hash, from: tx.from, to: tx.to ?? null, input: tx.input, value: tx.value, chainId: 'chainId' in tx ? tx.chainId : undefined } : null,
      receipt: receipt ? { status: receipt.status, blockNumber: receipt.blockNumber, logs: receipt.logs } : null,
      finalized: finalized.number ?? 0n,
    }
  } catch (error) {
    throw evmFailure(error)
  }
}

let decimalsCache: { token: string; decimals: number; at: number } | null = null

export async function baseTokenDecimals(context: Context, token: Hex) {
  if (decimalsCache && decimalsCache.token === token && Date.now() - decimalsCache.at < 300_000) return decimalsCache.decimals
  const decimals = await client(context)
    .readContract({ address: token, abi: ERC20_BURN_ABI, functionName: 'decimals' })
    .catch((error) => {
      throw new HttpError(500, 'TOKEN_INVALID', 'The configured Base token did not answer decimals(). Check QFORK_BASE_TOKEN.', { cause: (error as Error)?.name })
    })
  decimalsCache = { token, decimals: Number(decimals), at: Date.now() }
  return decimalsCache.decimals
}

export async function baseTokenSupply(context: Context, token: Hex) {
  try {
    return await client(context).readContract({ address: token, abi: ERC20_BURN_ABI, functionName: 'totalSupply' })
  } catch (error) {
    throw evmFailure(error)
  }
}
