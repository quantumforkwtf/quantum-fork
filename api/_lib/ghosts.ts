import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createRecord, type GhostLifetime, type GhostRecord, isLifetime, remainingMs, transition } from '../../src/protocol/ghostChain.js'
import { randomToken } from './http.js'

const MAX_ENVIRONMENTS = 2
const PORT_BASE = 18620

interface Live {
  record: GhostRecord
  node: ChildProcess | null
  logs: string[]
  timer: ReturnType<typeof setTimeout> | null
}

const environments = new Map<string, Live>()
let portCursor = PORT_BASE

function pushLog(live: Live, chunk: Buffer) {
  for (const line of chunk.toString('utf8').split('\n')) {
    const text = line.trim()
    if (!text) continue
    live.logs.push(text)
    if (live.logs.length > 80) live.logs.shift()
  }
}

async function rpc(port: number, method: string, params: unknown[] = []) {
  const response = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? 'RPC error')
  return body.result
}

function rssOf(pid: number | undefined) {
  if (!pid) return null
  const output = spawnSync('ps', ['-p', String(pid), '-o', 'rss='], { encoding: 'utf8' }).stdout.trim()
  const rss = Number(output)
  return Number.isFinite(rss) ? rss : null
}

async function txCount(port: number, height: number) {
  let total = 0
  const start = Math.max(0, height - 40)
  for (let block = start; block <= height; block += 1) {
    const count = await rpc(port, 'eth_getBlockTransactionCountByNumber', [`0x${block.toString(16)}`])
    total += Number(count)
  }
  return { total, fromBlock: start }
}

export async function metricsOf(live: Live) {
  const now = Date.now()
  const base = { id: live.record.id, chainId: live.record.chainId, port: live.record.port, lifetime: live.record.lifetime, status: live.record.status, remainingMs: remainingMs(live.record, now), expiresAt: live.record.expiresAt, error: live.record.error, rpc: `http://127.0.0.1:${live.record.port}` }
  if (live.record.status !== 'RUNNING') return { ...base, blockNumber: null, transactions: null, rpcOk: false, rssKb: rssOf(live.node?.pid), accounts: [], logs: live.logs }
  try {
    const [block, accounts] = await Promise.all([rpc(live.record.port, 'eth_blockNumber'), rpc(live.record.port, 'eth_accounts')])
    const height = Number(block)
    const transactions = await txCount(live.record.port, height)
    return { ...base, blockNumber: height, transactions, rpcOk: true, rssKb: rssOf(live.node?.pid), accounts, logs: live.logs }
  } catch (cause) {
    return { ...base, blockNumber: null, transactions: null, rpcOk: false, rssKb: rssOf(live.node?.pid), accounts: [], logs: live.logs, error: cause instanceof Error ? cause.message : 'RPC did not answer.' }
  }
}

function stopProcess(live: Live) {
  if (live.timer) clearTimeout(live.timer)
  live.timer = null
  live.node?.kill()
  live.node = null
}

async function finish(live: Live, event: 'expire' | 'terminate') {
  if (live.record.status === 'TERMINATED' || live.record.status === 'EXPIRING') return
  live.record = transition(live.record, event, Date.now())
  stopProcess(live)
  live.record = transition(live.record, 'stopped', Date.now())
}

export async function listGhosts() {
  const now = Date.now()
  for (const live of environments.values()) {
    if (live.record.status === 'RUNNING' && now >= live.record.expiresAt) await finish(live, 'expire')
  }
  return Promise.all([...environments.values()].map((live) => metricsOf(live)))
}

export async function createGhost(lifetime: GhostLifetime) {
  if (!isLifetime(lifetime)) throw new Error('Lifetime must be 15m, 1h, 6h, or 24h.')
  const active = [...environments.values()].filter((live) => live.record.status === 'CREATING' || live.record.status === 'RUNNING').length
  if (active >= MAX_ENVIRONMENTS) throw new Error(`This machine already has ${MAX_ENVIRONMENTS} environments. Terminate one first.`)
  const id = `gh_${randomToken(6)}`
  const chainId = 200_000 + Math.floor(Math.random() * 700_000)
  const port = portCursor++
  const live: Live = { record: createRecord({ id, chainId, port, lifetime, now: Date.now() }), node: null, logs: [], timer: null }
  environments.set(id, live)
  const node = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--chain-id', String(chainId), '--accounts', '3', '--balance', '1000'], { stdio: ['ignore', 'pipe', 'pipe'] })
  live.node = node
  node.stdout?.on('data', (chunk: Buffer) => pushLog(live, chunk))
  node.stderr?.on('data', (chunk: Buffer) => pushLog(live, chunk))
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (node.exitCode != null) throw new Error('Anvil exited before it accepted a connection.')
      const ready = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) }).then((response) => response.ok).catch(() => false)
      if (ready) break
      if (attempt === 49) throw new Error('Anvil did not start.')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const reported = Number(await rpc(port, 'eth_chainId'))
    if (reported !== chainId) throw new Error(`Anvil reported chain ${reported}, not ${chainId}.`)
    live.record = transition(live.record, 'started', Date.now())
    live.timer = setTimeout(() => { void finish(live, 'expire') }, Math.max(0, live.record.expiresAt - Date.now()))
    return metricsOf(live)
  } catch (cause) {
    live.record = transition(live.record, 'fail', Date.now(), cause instanceof Error ? cause.message : 'Anvil did not start.')
    stopProcess(live)
    live.record = transition(live.record, 'stopped', Date.now())
    throw cause
  }
}

export async function terminateGhost(id: string) {
  const live = environments.get(id)
  if (!live) throw new Error('No environment with that id.')
  await finish(live, 'terminate')
  return metricsOf(live)
}

export async function snapshotGhost(id: string) {
  const live = environments.get(id)
  if (!live || live.record.status !== 'RUNNING') throw new Error('Only a running environment can be snapshotted.')
  const state = await rpc(live.record.port, 'anvil_dumpState')
  if (typeof state !== 'string' || !state.startsWith('0x')) throw new Error('Anvil did not return a state dump.')
  return { id, state }
}

export function resetGhostsForTests() {
  for (const live of environments.values()) stopProcess(live)
  environments.clear()
  portCursor = PORT_BASE
}
