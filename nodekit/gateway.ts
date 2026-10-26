import { createServer, type IncomingMessage, type Server } from 'node:http'
import { GATEWAY_MAX_BATCH, gatewayRefusal } from '../src/protocol/nodes.js'

const MAX_BODY_BYTES = 128 * 1024
const WINDOW_MS = 60_000
const CALLS_PER_WINDOW = 600

export interface GatewayOptions {
  /** The node's own RPC, reachable only from this machine. */
  upstream: string
  host?: string
  port?: number
  chainId?: number
}

type RpcCall = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0
        reject(new Error('TOO_LARGE'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/**
 * A read-mostly JSON-RPC front for a node. It answers standard chain queries and accepts signed
 * transactions, and refuses everything else: no unlocked accounts, admin, debug, txpool or devnet
 * methods ever reach the node from outside.
 */
export function startGateway(options: GatewayOptions): Promise<{ server: Server; url: string }> {
  const windows = new Map<string, { start: number; calls: number }>()
  const allow = (ip: string, calls: number) => {
    const now = Date.now()
    const window = windows.get(ip)
    if (!window || now - window.start > WINDOW_MS) {
      if (windows.size > 10_000) windows.clear()
      windows.set(ip, { start: now, calls })
      return calls <= CALLS_PER_WINDOW
    }
    window.calls += calls
    return window.calls <= CALLS_PER_WINDOW
  }

  const forward = async (call: RpcCall) => {
    const refusal = gatewayRefusal(call)
    if (refusal) return { jsonrpc: '2.0', id: call.id ?? null, error: { code: -32601, message: refusal } }
    try {
      const response = await fetch(options.upstream, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: call.id ?? null, method: call.method, params: call.params ?? [] }), signal: AbortSignal.timeout(15_000) })
      return (await response.json()) as unknown
    } catch {
      return { jsonrpc: '2.0', id: call.id ?? null, error: { code: -32603, message: 'The node did not answer.' } }
    }
  }

  const server = createServer(async (request, response) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(body))
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...headers, 'Access-Control-Max-Age': '600' })
      return response.end()
    }
    if (request.method === 'GET') return send(200, { name: 'qfork-node-gateway', version: 1, chainId: options.chainId ?? null })
    if (request.method !== 'POST') return send(405, { error: 'Use POST with JSON-RPC.' })

    let body: unknown
    try {
      body = JSON.parse(await readBody(request))
    } catch (error) {
      if ((error as Error).message === 'TOO_LARGE') response.setHeader('Connection', 'close')
      return send((error as Error).message === 'TOO_LARGE' ? 413 : 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Send a JSON-RPC body under 128 KB.' } })
    }
    const batch = Array.isArray(body)
    const calls = (batch ? body : [body]) as RpcCall[]
    if (!calls.length || calls.length > GATEWAY_MAX_BATCH || calls.some((call) => !call || typeof call !== 'object')) {
      return send(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `Send one call or a batch of at most ${GATEWAY_MAX_BATCH}.` } })
    }
    if (!allow(request.socket.remoteAddress ?? 'unknown', calls.length)) return send(429, { jsonrpc: '2.0', id: null, error: { code: -32005, message: 'Too many requests. Wait a minute.' } })
    const results = await Promise.all(calls.map(forward))
    send(200, batch ? results : results[0])
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 8545, options.host ?? '127.0.0.1', () => {
      const bound = server.address()
      const port = typeof bound === 'object' && bound ? bound.port : (options.port ?? 8545)
      resolve({ server, url: `http://${options.host && options.host !== '0.0.0.0' ? options.host : '127.0.0.1'}:${port}` })
    })
  })
}
