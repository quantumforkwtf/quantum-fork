import { CLIENT_CONFIG } from '../../config'
import { FlowError } from '../failures'

let id = 0

async function call<T>(method: string, params: unknown[], timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(CLIENT_CONFIG.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: (id += 1), method, params }),
      signal: controller.signal,
    })
    if (!response.ok) throw new FlowError('RPC_UNAVAILABLE', `RPC responded ${response.status}.`)
    const body = (await response.json()) as { result?: T; error?: { message: string; data?: unknown } }
    if (body.error) throw Object.assign(new Error(body.error.message), { rpc: body.error })
    return body.result as T
  } catch (error) {
    if (error instanceof FlowError || (error as { rpc?: unknown }).rpc) throw error
    throw new FlowError('RPC_UNAVAILABLE', error instanceof DOMException && error.name === 'AbortError' ? 'The RPC did not respond in time.' : 'The RPC could not be reached.')
  } finally {
    window.clearTimeout(timer)
  }
}

export interface TokenHolding {
  address: string
  amountRaw: bigint
  decimals: number
  frozen: boolean
}

export interface MintInfo {
  address: string
  tokenProgram: string
  decimals: number
  supplyRaw: bigint
}

export const rpc = {
  async getBalance(address: string) {
    const result = await call<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }])
    return BigInt(result.value)
  },
  async getMint(address: string): Promise<MintInfo | null> {
    const result = await call<{ value: { owner: string; data: { parsed?: { type: string; info: { decimals: number; supply: string } } } } | null }>('getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }])
    const parsed = result.value?.data.parsed
    if (!result.value || parsed?.type !== 'mint') return null
    return { address, tokenProgram: result.value.owner, decimals: parsed.info.decimals, supplyRaw: BigInt(parsed.info.supply) }
  },
  async getHoldings(owner: string, mint: string): Promise<TokenHolding[]> {
    type Item = { pubkey: string; account: { data: { parsed: { info: { state: string; tokenAmount: { amount: string; decimals: number } } } } } }
    const result = await call<{ value: Item[] }>('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }])
    return result.value
      .map((item) => ({
        address: item.pubkey,
        amountRaw: BigInt(item.account.data.parsed.info.tokenAmount.amount),
        decimals: item.account.data.parsed.info.tokenAmount.decimals,
        frozen: item.account.data.parsed.info.state === 'frozen',
      }))
      .sort((a, b) => (b.amountRaw > a.amountRaw ? 1 : b.amountRaw < a.amountRaw ? -1 : 0))
  },
  async getLatestBlockhash() {
    const result = await call<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }])
    return result.value
  },
  async getFeeForMessage(messageBase64: string) {
    const result = await call<{ value: number | null }>('getFeeForMessage', [messageBase64, { commitment: 'confirmed' }])
    return result.value === null ? null : BigInt(result.value)
  },
  async simulate(transactionBase64: string) {
    const result = await call<{ value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }>('simulateTransaction', [transactionBase64, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed' }])
    return result.value
  },
  async send(transactionBase64: string) {
    return call<string>('sendTransaction', [transactionBase64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 }], 20_000)
  },
  async getSignatureStatus(signature: string) {
    const result = await call<{ value: ({ confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null; err: unknown } | null)[] }>('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])
    return result.value[0]
  },
  async getMinimumBalanceForRentExemption(space: number) {
    return BigInt(await call<number>('getMinimumBalanceForRentExemption', [space, { commitment: 'confirmed' }]))
  },
  async getBlockHeight() {
    return call<number>('getBlockHeight', [{ commitment: 'confirmed' }])
  },
}
