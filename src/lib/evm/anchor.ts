import { BaseError, ContractFunctionRevertedError, createPublicClient, custom, decodeErrorResult, type Hex, numberToHex } from 'viem'
import type { BaseNetwork } from '../../protocol/base'
import type { ChainDna } from '../../protocol/chainDna'
import { REGISTRY_ABI, registerCalldata } from '../../protocol/registry'
import { api, ApiError } from '../api'
import { FlowError } from '../failures'
import { ensureBaseChain, evmProvider } from './wallet'

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
  network: BaseNetwork
  chainId: number
  registry: Hex
  kind: number
  version: number
  txHash: Hex
  blockNumber: number
  metadataURI: string
  verifiedAt: string
}

export async function publishDna(dna: ChainDna): Promise<PublishedConfig> {
  try {
    const { data } = await api<{ config: PublishedConfig }>('/api/configs', { method: 'POST', body: { action: 'publish', dna }, accept: [200, 201], timeoutMs: 20_000 })
    return data.config
  } catch (error) {
    if (error instanceof ApiError) throw new FlowError('API_UNAVAILABLE', error.message, { correlationId: error.correlationId })
    throw new FlowError('API_UNAVAILABLE')
  }
}

function reason(error: unknown) {
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
    if (reverted?.data?.errorName === 'AlreadyRegistered') return 'This wallet already anchored this exact configuration.'
    const data = (error.walk((cause) => typeof (cause as { data?: unknown }).data === 'string') as { data?: Hex } | null)?.data
    if (data) {
      try {
        const decoded = decodeErrorResult({ abi: REGISTRY_ABI, data })
        if (decoded.errorName === 'AlreadyRegistered') return 'This wallet already anchored this exact configuration.'
        return `The registry rejected it: ${decoded.errorName}.`
      } catch {
        // Not a registry error.
      }
    }
    return error.shortMessage
  }
  return (error as Error)?.message?.split('\n')[0] ?? 'Unknown error'
}

export interface AnchorReview {
  owner: Hex
  registry: Hex
  network: BaseNetwork
  chainId: number
  data: Hex
  gas: bigint
  feeWei: bigint
  ethWei: bigint
  uri: string
}

/** Builds register(hash, kind, uri) and dry-runs it from the connected wallet. Nothing is signed. */
export async function prepareAnchor(input: { owner: Hex; registry: Hex; network: BaseNetwork; chainId: number; hash: Hex; kind: number; uri: string }): Promise<AnchorReview> {
  await ensureBaseChain(input.network, input.chainId)
  const client = createPublicClient({ transport: custom(evmProvider()) })
  const data = registerCalldata(input.hash, input.kind, input.uri)
  try {
    const [gas, gasPrice, ethWei] = await Promise.all([client.estimateGas({ account: input.owner, to: input.registry, data, value: 0n }), client.getGasPrice(), client.getBalance({ address: input.owner })])
    const feeWei = gas * gasPrice
    if (ethWei < feeWei) throw new FlowError('INSUFFICIENT_ETH', `Gas is about ${Number(feeWei) / 1e18} ETH; the wallet holds ${Number(ethWei) / 1e18} ETH.`)
    return { owner: input.owner, registry: input.registry, network: input.network, chainId: input.chainId, data, gas, feeWei, ethWei, uri: input.uri }
  } catch (error) {
    if (error instanceof FlowError) throw error
    throw new FlowError('ANCHOR_FAILED', reason(error))
  }
}

export async function sendAnchor(review: AnchorReview): Promise<Hex> {
  await ensureBaseChain(review.network, review.chainId)
  let hash: Hex
  try {
    hash = (await evmProvider().request({
      method: 'eth_sendTransaction',
      params: [{ from: review.owner, to: review.registry, data: review.data, value: '0x0', gas: numberToHex((review.gas * 12n) / 10n) }],
    })) as Hex
  } catch (error) {
    const code = (error as { code?: number })?.code
    throw new FlowError(code === 4001 ? 'WALLET_REJECTED' : 'ANCHOR_FAILED', (error as Error)?.message?.split('\n')[0])
  }
  const sent = await createPublicClient({ transport: custom(evmProvider()) })
    .getTransaction({ hash })
    .catch(() => null)
  if (sent && (sent.input.toLowerCase() !== review.data.toLowerCase() || sent.to?.toLowerCase() !== review.registry.toLowerCase())) throw new FlowError('TX_MODIFIED', undefined, { signature: hash })
  return hash
}

type Outcome = { status: 'PENDING' } | { status: 'VERIFIED'; anchor: AnchorRecord } | { status: 'FAILED'; code: string; message: string }

/** Polls until the server has read the registration at a finalized Base block. */
export async function verifyAnchorTx(hash: Hex, txHash: Hex, onPending?: () => void, signal?: AbortSignal): Promise<AnchorRecord> {
  let transient = 0
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const { data } = await api<Outcome>('/api/configs', { method: 'POST', body: { action: 'verify-anchor', hash, txHash }, accept: [202, 422], timeoutMs: 25_000 })
      transient = 0
      if (data.status === 'VERIFIED') return data.anchor
      if (data.status === 'FAILED') throw new FlowError(data.code === 'TX_FAILED' ? 'ANCHOR_FAILED' : 'ANCHOR_NOT_RECORDED', data.message, { signature: txHash })
      onPending?.()
    } catch (error) {
      if (error instanceof FlowError) throw error
      transient += 1
      if (transient > 6) throw new FlowError('ANCHOR_NOT_RECORDED', 'The server could not be reached to verify the anchor.', { signature: txHash })
    }
    await new Promise((resolve) => window.setTimeout(resolve, 10_000))
  }
  throw new FlowError('ANCHOR_NOT_RECORDED', 'Base has not finalized the transaction yet.', { signature: txHash })
}
