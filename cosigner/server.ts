import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { type Hex, isHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { parseCosignRequest } from '../src/protocol/cosigner.js'
import { cosign, type CosignerRuntime } from '../src/protocol/cosignerService.js'

export const COSIGNER_VERSION = 1
export const DEFAULT_PORT = 7454
export const DEFAULT_ORIGINS = ['https://quantumfork.wtf']
const MAX_BODY_BYTES = 1024 * 1024

export interface CosignerOptions {
  rpcUrl: string
  chainId: number
  network: string
  keyFile: string
  port?: number
  /** Browser origins allowed to call it. Requests from any other origin are refused. */
  origins?: string[]
}

/** Reads the co-signer key, or creates one on first run. The file is readable by its owner only. */
export function loadOrCreateKey(keyFile: string): { address: Hex; privateKey: Hex; created: boolean } {
  if (existsSync(keyFile)) {
    const parsed = JSON.parse(readFileSync(keyFile, 'utf8')) as { privateKey?: string }
    if (!parsed.privateKey || !isHex(parsed.privateKey) || parsed.privateKey.length !== 66) throw new Error(`${keyFile} does not hold a co-signer key.`)
    return { address: privateKeyToAccount(parsed.privateKey).address, privateKey: parsed.privateKey, created: false }
  }
  mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 })
  const privateKey = generatePrivateKey()
  const address = privateKeyToAccount(privateKey).address
  writeFileSync(keyFile, `${JSON.stringify({ format: 'qfork.cosigner.v1', address, privateKey }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  chmodSync(keyFile, 0o600)
  return { address, privateKey, created: true }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('TOO_LARGE'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

export function startCosigner(options: CosignerOptions): Promise<{ server: Server; address: Hex; url: string; created: boolean }> {
  const key = loadOrCreateKey(options.keyFile)
  const runtime: CosignerRuntime = { rpcUrl: options.rpcUrl, chainId: options.chainId, signer: privateKeyToAccount(key.privateKey) }
  const origins = new Set(options.origins ?? DEFAULT_ORIGINS)
  const inFlight = new Set<string>()

  const send = (response: ServerResponse, status: number, body: unknown, origin?: string) => {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    })
    response.end(JSON.stringify(body))
  }

  const server = createServer(async (request, response) => {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined
    const allowed = origin && origins.has(origin) ? origin : undefined
    const path = (request.url ?? '/').split('?')[0]
    if (request.method === 'OPTIONS') {
      if (!allowed) return send(response, 403, { error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin may not use this co-signer.' } })
      response.writeHead(204, {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      })
      return response.end()
    }
    if (origin && !allowed) return send(response, 403, { error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin may not use this co-signer.' } })
    if (request.method === 'GET' && path === '/v1/info') {
      return send(response, 200, { name: 'qfork-cosigner', version: COSIGNER_VERSION, mode: 'self-hosted', address: key.address, chainId: options.chainId, network: options.network }, allowed)
    }
    if (request.method === 'POST' && path === '/v1/cosign') {
      let body: unknown
      try {
        body = JSON.parse(await readBody(request))
      } catch (error) {
        return send(response, (error as Error).message === 'TOO_LARGE' ? 413 : 400, { error: { code: 'BAD_REQUEST', message: 'Send a JSON body under 1 MB.' } }, allowed)
      }
      const parsed = parseCosignRequest(body)
      if (typeof parsed === 'string') return send(response, 400, { error: { code: 'BAD_REQUEST', message: parsed } }, allowed)
      const lock = `${parsed.account.toLowerCase()}:${parsed.proposalId}`
      if (inFlight.has(lock)) return send(response, 409, { error: { code: 'IN_PROGRESS', message: 'This proposal is already being co-signed.' } }, allowed)
      inFlight.add(lock)
      try {
        const outcome = await cosign(runtime, parsed)
        if (!outcome.ok) return send(response, 422, { error: { code: outcome.code, message: outcome.message } }, allowed)
        console.log(`approved #${parsed.proposalId} on ${parsed.account} (${outcome.class}, ${outcome.signers.length} post-quantum signature${outcome.signers.length === 1 ? '' : 's'}) ${outcome.hash}`)
        return send(response, 200, { hash: outcome.hash, class: outcome.class, signers: outcome.signers.length }, allowed)
      } finally {
        inFlight.delete(lock)
      }
    }
    send(response, 404, { error: { code: 'NOT_FOUND', message: 'Use GET /v1/info or POST /v1/cosign.' } }, allowed)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? DEFAULT_PORT, '127.0.0.1', () => {
      const bound = server.address()
      const port = typeof bound === 'object' && bound ? bound.port : (options.port ?? DEFAULT_PORT)
      resolve({ server, address: key.address, url: `http://127.0.0.1:${port}`, created: key.created })
    })
  })
}
