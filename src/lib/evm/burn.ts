import { createPublicClient, custom, type Hex, numberToHex } from 'viem'
import { burnCalldata, burnTag, ERC20_BURN_ABI, type BaseNetwork } from '../../protocol/base'
import { FlowError } from '../failures'
import { ensureBaseChain, evmProvider } from './wallet'

export interface BaseBurnRequest {
  owner: Hex
  token: Hex
  /** Whole QFORK required, as returned by the server for this deployment. */
  amount: number
  memo: string
  network: BaseNetwork
  chainId: number
}

export interface PreparedBaseBurn {
  request: BaseBurnRequest
  decimals: number
  amountRaw: bigint
  balanceRaw: bigint
  data: Hex
  tag: Hex
  gas: bigint
  feeWei: bigint
  ethWei: bigint
}

/** EIP-7702 delegated EOAs carry this code prefix and still send their own transactions. */
const DELEGATION_PREFIX = '0xef0100'

function reader() {
  return createPublicClient({ transport: custom(evmProvider()) })
}

/** Switches the wallet to Base, reads balances, builds the exact calldata and dry-runs it. Nothing is signed. */
export async function prepareBaseBurn(request: BaseBurnRequest): Promise<PreparedBaseBurn> {
  await ensureBaseChain(request.network, request.chainId)
  const client = reader()
  try {
    const code = await client.getCode({ address: request.owner })
    if (code && code !== '0x' && !code.toLowerCase().startsWith(DELEGATION_PREFIX)) throw new FlowError('WALLET_UNSUPPORTED')

    const [decimals, balanceRaw, ethWei, gasPrice] = await Promise.all([
      client.readContract({ address: request.token, abi: ERC20_BURN_ABI, functionName: 'decimals' }),
      client.readContract({ address: request.token, abi: ERC20_BURN_ABI, functionName: 'balanceOf', args: [request.owner] }),
      client.getBalance({ address: request.owner }),
      client.getGasPrice(),
    ])
    const amountRaw = BigInt(request.amount) * 10n ** BigInt(decimals)
    if (balanceRaw < amountRaw) {
      throw new FlowError('INSUFFICIENT_QFORK', `Requires ${request.amount.toLocaleString('en-US')} QFORK on Base. Wallet holds ${(Number(balanceRaw) / 10 ** Number(decimals)).toLocaleString('en-US')}.`)
    }
    const tag = burnTag(request.memo)
    const data = burnCalldata(amountRaw, tag)
    let gas: bigint
    try {
      gas = await client.estimateGas({ account: request.owner, to: request.token, data, value: 0n })
    } catch (error) {
      throw new FlowError('SIMULATION_FAILED', `The dry run failed. Nothing was sent. ${(error as Error)?.message?.split('\n')[0] ?? ''}`.trim())
    }
    const feeWei = gas * gasPrice
    if (ethWei < feeWei) throw new FlowError('INSUFFICIENT_ETH', `Gas is about ${Number(feeWei) / 1e18} ETH; the wallet holds ${Number(ethWei) / 1e18} ETH.`)
    return { request, decimals: Number(decimals), amountRaw, balanceRaw, data, tag, gas, feeWei, ethWei }
  } catch (error) {
    if (error instanceof FlowError) throw error
    throw new FlowError('RPC_UNAVAILABLE', (error as Error)?.message?.split('\n')[0])
  }
}

/**
 * Re-checks chain state, asks the wallet to send exactly the reviewed call, then reads the
 * transaction back. `onSent` runs as soon as a hash exists so verification survives a reload.
 */
export async function sendBaseBurn(review: PreparedBaseBurn, onSent: (hash: Hex) => void): Promise<Hex> {
  const fresh = await prepareBaseBurn(review.request)
  if (fresh.data !== review.data || fresh.amountRaw !== review.amountRaw) throw new FlowError('SIMULATION_FAILED', 'Chain state changed since review. Review the transaction again.')
  let hash: Hex
  try {
    hash = (await evmProvider().request({
      method: 'eth_sendTransaction',
      params: [{ from: review.request.owner, to: review.request.token, data: review.data, value: '0x0', gas: numberToHex((fresh.gas * 12n) / 10n) }],
    })) as Hex
  } catch (error) {
    const code = (error as { code?: number })?.code
    throw new FlowError(code === 4001 ? 'WALLET_REJECTED' : 'SIMULATION_FAILED', (error as Error)?.message?.split('\n')[0])
  }
  onSent(hash)
  const sent = await reader()
    .getTransaction({ hash })
    .catch(() => null)
  if (sent && (sent.input.toLowerCase() !== review.data.toLowerCase() || sent.to?.toLowerCase() !== review.request.token.toLowerCase())) {
    throw new FlowError('TX_MODIFIED', undefined, { signature: hash })
  }
  return hash
}
