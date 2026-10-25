import { type Hex } from 'viem'
import { BASE_PUBLIC_RPC, type BaseNetwork } from '../../protocol/base'
import { type AnvilMetadata, isLoopbackRpc, type Rpc } from '../../protocol/realityFork'

export class ForkRpcError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_LOOPBACK' | 'UNREACHABLE' | 'RPC_ERROR',
  ) {
    super(message)
  }
}

async function post(url: string, method: string, params: unknown[]) {
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  } catch {
    throw new ForkRpcError(`Could not reach ${url}. Is Anvil running there? On the live site your browser may first ask to allow access to your local network.`, 'UNREACHABLE')
  }
  const body = (await response.json().catch(() => ({}))) as { result?: unknown; error?: { message?: string } }
  if (body.error) throw new ForkRpcError(`${method}: ${body.error.message ?? 'failed'}`, 'RPC_ERROR')
  return body.result
}

/** A JSON-RPC client for a local Anvil fork. Anything that is not a loopback address is refused. */
export function forkRpc(url: string): Rpc {
  if (!isLoopbackRpc(url)) throw new ForkRpcError('Fork endpoints must be http://127.0.0.1:<port> or http://localhost:<port>. Anvil-only methods are never sent to a public network.', 'NOT_LOOPBACK')
  return (method, params = []) => post(url, method, params)
}

export async function forkMetadata(rpc: Rpc) {
  return (await rpc('anvil_metadata')) as AnvilMetadata
}

/** Reads a block from the real network's public endpoint (read-only). */
export async function realBlock(source: BaseNetwork, block: number | 'finalized') {
  const tag = block === 'finalized' ? 'finalized' : `0x${block.toString(16)}`
  const result = (await post(BASE_PUBLIC_RPC[source], 'eth_getBlockByNumber', [tag, false])) as { number: Hex; hash: Hex; timestamp: Hex } | null
  if (!result) throw new ForkRpcError(`Block ${block} does not exist on ${source === 'base' ? 'Base' : 'Base Sepolia'} yet.`, 'RPC_ERROR')
  return { number: Number(BigInt(result.number)), hash: result.hash, timestamp: Number(BigInt(result.timestamp)) }
}
