import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'
import { isProfile, PROFILES, type ProfileId, type ResourceSample, runWorkload, type SideReport, summarize, type WorkloadId } from '../../src/protocol/forkWars.js'

/** One benchmark at a time. Two Anvil processes are enough to saturate a laptop. */
let running = false

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const answers = (url: string) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) })
    .then((response) => response.ok)
    .catch(() => false)

async function start(args: readonly string[], port: number) {
  const url = `http://127.0.0.1:${port}`
  if (await answers(url)) throw new Error(`Port ${port} is already serving JSON-RPC; stop that node first.`)
  const node = spawn('anvil', [...args, '--port', String(port), '--silent'], { stdio: 'ignore' })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (node.exitCode != null) throw new Error('Anvil exited before it accepted a connection.')
    if ((await answers(url)) && node.pid) return { node, url, pid: node.pid }
    await sleep(100)
  }
  node.kill()
  throw new Error(`Anvil did not start on port ${port}.`)
}

async function watch(pid: number, into: number[][], stop: { done: boolean }) {
  while (!stop.done) {
    const output = spawnSync('ps', ['-p', String(pid), '-o', 'rss=,%cpu='], { encoding: 'utf8' }).stdout?.trim() ?? ''
    const [rss, cpu] = output ? output.split(/\s+/).map(Number) : []
    if (Number.isFinite(rss) && Number.isFinite(cpu)) into.push([rss, cpu])
    await sleep(200)
  }
}

function resourcesOf(rows: number[][]): ResourceSample | undefined {
  if (!rows.length) return undefined
  return {
    peakRssKb: Math.max(...rows.map((row) => row[0])),
    meanCpuPercent: rows.reduce((sum, row) => sum + row[1], 0) / rows.length,
    observations: rows.length,
  }
}

async function side(profile: ProfileId, port: number, workload: WorkloadId, count: number): Promise<SideReport> {
  if (!isProfile(profile)) throw new Error('Unknown Anvil profile.')
  const args = PROFILES[profile].args
  const started = await start(args, port)
  const rows: number[][] = []
  const stop = { done: false }
  const sampling = watch(started.pid, rows, stop)
  try {
    const result = await runWorkload(started.url, workload, count)
    return { profile, args, samples: result.samples, summary: summarize(result.samples, result.elapsedMs), resources: resourcesOf(rows) }
  } finally {
    stop.done = true
    started.node.kill()
    await sampling.catch(() => undefined)
  }
}

export function machineFacts() {
  const cpu = os.cpus()[0]
  const version = spawnSync('anvil', ['--version'], { encoding: 'utf8' })
  return {
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpu?.model ?? null,
    cpus: os.cpus().length,
    node: process.version,
    anvil: version.stdout.trim().split('\n')[0] || null,
  }
}

/** Starts two loopback Anvil nodes, runs the same workload on both, and stops them. */
export async function runPair(left: ProfileId, right: ProfileId, workload: WorkloadId, count: number): Promise<SideReport[]> {
  if (running) throw new Error('A benchmark is already running on this machine.')
  running = true
  try {
    return await Promise.all([side(left, 18581, workload, count), side(right, 18582, workload, count)])
  } finally {
    running = false
  }
}
