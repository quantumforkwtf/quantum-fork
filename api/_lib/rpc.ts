import type { ParsedTx } from '../../src/protocol/verifyBurn.js'
import { HttpError } from './http.js'

export type Commitment = 'confirmed' | 'finalized'

export class RpcError extends Error {
  constructor(
    readonly code: 'RPC_TIMEOUT' | 'RPC_UNAVAILABLE' | 'RPC_ERROR',
    message: string,
  ) {
    super(message)
  }
}

export function rpcClient(url: string, timeoutMs = 8000) {
  let id = 0
  const call = async <T>(method: string, params: unknown[]): Promise<T> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: (id += 1), method, params }),
        signal: controller.signal,
      })
      if (!response.ok) throw new RpcError('RPC_UNAVAILABLE', `RPC responded ${response.status}`)
      const body = (await response.json()) as { result?: T; error?: { message: string } }
      if (body.error) throw new RpcError('RPC_ERROR', body.error.message)
      return body.result as T
    } catch (error) {
      if (error instanceof RpcError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new RpcError('RPC_TIMEOUT', 'RPC request timed out')
      throw new RpcError('RPC_UNAVAILABLE', 'RPC request failed')
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    getParsedTransaction: (signature: string, commitment: Commitment) =>
      call<ParsedTx | null>('getTransaction', [signature, { encoding: 'jsonParsed', commitment, maxSupportedTransactionVersion: 0 }]),
    getSignatureStatus: async (signature: string) => {
      const result = await call<{ value: ({ confirmationStatus: string | null; err: unknown } | null)[] }>('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])
      return result.value[0]
    },
    getParsedAccount: (address: string) =>
      call<{ value: { owner: string; data: { parsed?: { type: string; info: Record<string, unknown> } } | [string, string] } | null }>('getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    getRawAccount: (address: string) =>
      call<{ value: { owner: string; data: [string, string] } | null }>('getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }]),
    getBalance: async (address: string) => BigInt((await call<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }])).value),
    getLatestBlockhash: async () => (await call<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }])).value,
    sendTransaction: (base64: string) => call<string>('sendTransaction', [base64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 }]),
  }
}

export function rpcFailure(error: unknown): HttpError {
  if (error instanceof RpcError) {
    return new HttpError(503, error.code, error.code === 'RPC_TIMEOUT' ? 'The Solana RPC did not respond in time. Nothing was recorded; it is safe to retry.' : 'The Solana RPC is unavailable. Nothing was recorded; it is safe to retry.')
  }
  return new HttpError(503, 'RPC_UNAVAILABLE', 'The Solana RPC is unavailable. Nothing was recorded; it is safe to retry.')
}
