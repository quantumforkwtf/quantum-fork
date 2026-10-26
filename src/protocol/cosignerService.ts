import { type Account, createPublicClient, createWalletClient, getAddress, type Hex, http } from 'viem'
import { ACCOUNT_ABI, approveCalldata } from './account.js'
import { checkCosign, type CosignChainState, type CosignClass, type CosignCode, type CosignRequest } from './cosigner.js'

/** Runs the same way in the self-hosted co-signer and the hosted one; only the key and RPC differ. */
export interface CosignerRuntime {
  rpcUrl: string
  chainId: number
  signer: Account
  receiptTimeoutMs?: number
  /** Called once every check has passed, just before spending gas. Return a message to refuse. */
  beforeApprove?: (request: CosignRequest) => Promise<string | null>
}

export type CosignOutcome = { ok: true; hash: Hex; class: CosignClass; signers: Hex[] } | { ok: false; code: CosignCode | 'CHAIN_UNAVAILABLE' | 'NOT_AN_ACCOUNT' | 'APPROVE_FAILED' | 'LIMITED'; message: string }

type RawProposal = { to: Hex; createdAt: bigint; executed: boolean; cancelled: boolean; value: bigint; data: Hex }

export async function readCosignState(runtime: CosignerRuntime, request: CosignRequest): Promise<CosignChainState> {
  const client = createPublicClient({ transport: http(runtime.rpcUrl) })
  const chainId = await client.getChainId()
  const read = <T,>(functionName: string, args: readonly unknown[] = []) =>
    (client.readContract as (call: { address: Hex; abi: typeof ACCOUNT_ABI; functionName: string; args: readonly unknown[] }) => Promise<unknown>)({ address: request.account, abi: ACCOUNT_ABI, functionName, args }) as Promise<T>
  const [keyset, cosignerIsOwner, count] = await Promise.all([read<Hex>('keyset'), read<boolean>('isOwner', [runtime.signer.address]), read<bigint>('proposalCount')])
  if (request.proposalId >= count) return { chainId, keyset, cosignerIsOwner, alreadyApproved: false, proposal: null }
  const [proposal, alreadyApproved] = await Promise.all([read<RawProposal>('proposal', [request.proposalId]), read<boolean>('hasApproved', [request.proposalId, runtime.signer.address])])
  return { chainId, keyset, cosignerIsOwner, alreadyApproved, proposal: { to: proposal.to, value: proposal.value, data: proposal.data, executed: proposal.executed, cancelled: proposal.cancelled } }
}

/** Reads the chain, checks the post-quantum signatures and, only if they hold, sends approve(id). */
export async function cosign(runtime: CosignerRuntime, request: CosignRequest): Promise<CosignOutcome> {
  let state: CosignChainState
  try {
    const client = createPublicClient({ transport: http(runtime.rpcUrl) })
    const code = await client.getCode({ address: request.account })
    if (!code || code === '0x') return { ok: false, code: 'NOT_AN_ACCOUNT', message: 'There is no contract at that address.' }
    state = await readCosignState(runtime, request)
  } catch (error) {
    return { ok: false, code: 'CHAIN_UNAVAILABLE', message: `Could not read the account: ${(error as Error)?.message?.split('\n')[0] ?? 'unknown error'}` }
  }
  if (state.chainId !== runtime.chainId) return { ok: false, code: 'CHAIN_UNAVAILABLE', message: `The RPC is on chain ${state.chainId}, not ${runtime.chainId}.` }
  const check = checkCosign(request, state)
  if (!check.ok) return check
  const limited = await runtime.beforeApprove?.(request)
  if (limited) return { ok: false, code: 'LIMITED', message: limited }
  try {
    const wallet = createWalletClient({ account: runtime.signer, transport: http(runtime.rpcUrl) })
    const client = createPublicClient({ transport: http(runtime.rpcUrl) })
    const hash = await wallet.sendTransaction({ to: getAddress(request.account), data: approveCalldata(request.proposalId), chain: null })
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: runtime.receiptTimeoutMs ?? 120_000 })
    if (receipt.status !== 'success') return { ok: false, code: 'APPROVE_FAILED', message: 'The approval transaction reverted.' }
    return { ok: true, hash, class: check.class, signers: check.signers }
  } catch (error) {
    return { ok: false, code: 'APPROVE_FAILED', message: (error as { shortMessage?: string })?.shortMessage ?? (error as Error)?.message?.split('\n')[0] ?? 'The approval could not be sent.' }
  }
}
