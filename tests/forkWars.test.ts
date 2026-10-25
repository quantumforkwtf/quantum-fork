import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { POST } from '../api/benchmarks'
import { runPair } from '../api/_lib/benchRun'
import { runWorkload, summarize, type TxSample } from '../src/protocol/forkWars'

const hasAnvil = spawnSync('anvil', ['--version']).status === 0

describe('fork wars summaries', () => {
  it('computes throughput from successes and elapsed time', () => {
    const samples: TxSample[] = [
      { label: 'a', hash: null, status: 'success', gasUsed: 100n, latencyMs: 10, error: null },
      { label: 'b', hash: null, status: 'reverted', gasUsed: 50n, latencyMs: 30, error: 'reverted' },
    ]
    const summary = summarize(samples, 1000)
    expect(summary.failureRate).toBe(0.5)
    expect(summary.throughputPerSec).toBe(1)
    expect(summary.meanGas).toBe(150n)
    expect(summarize([], 0).throughputPerSec).toBeNull()
  })

  it('rejects a workload size outside the limit before talking to a node', async () => {
    await expect(runWorkload('http://127.0.0.1:1', 'erc20', 3)).rejects.toThrow(/4 to 12/)
    await expect(runWorkload('https://sepolia.base.org', 'erc20', 4)).rejects.toThrow(/127\.0\.0\.1/)
  })

  it('rejects an oversized request before starting Anvil', async () => {
    const response = await POST(new Request('http://127.0.0.1/api/benchmarks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ left: 'automine', right: 'interval', workload: 'erc20', count: 1000 }) }))
    expect(response.status).toBe(400)
  })
})

describe.skipIf(!hasAnvil)('fork wars on Anvil', () => {
  it('runs the same ERC-20 workload on automine and one-second blocks', async () => {
    const sides = await runPair('automine', 'interval', 'erc20', 4)
    for (const side of sides) {
      expect(side.samples.every((sample) => sample.status === 'success')).toBe(true)
      expect(side.summary.failed).toBe(0)
      expect(side.resources?.peakRssKb).toBeGreaterThan(0)
      expect(side.resources?.observations).toBeGreaterThan(0)
    }
    const fast = sides[0].summary.meanLatencyMs ?? 0
    const slow = sides[1].summary.meanLatencyMs ?? 0
    expect(slow).toBeGreaterThan(fast)
    const fastGas = sides[0].samples.filter((sample) => sample.label.startsWith('ERC-20')).map((sample) => sample.gasUsed)
    const slowGas = sides[1].samples.filter((sample) => sample.label.startsWith('ERC-20')).map((sample) => sample.gasUsed)
    expect(fastGas).toEqual(slowGas)
  }, 60_000)

  it('runs every other workload to a successful receipt', async () => {
    for (const workload of ['storage', 'compute', 'deploy', 'mixed', 'erc721'] as const) {
      const [side] = await runPair('automine', 'automine', workload, 4)
      expect(side.samples.every((sample) => sample.status === 'success')).toBe(true)
      expect(side.summary.totalGas > 0n).toBe(true)
    }
  }, 90_000)
})
