import { z } from 'zod'
import { BENCH_COUNT_MAX, BENCH_COUNT_MIN, FORK_WARS_SPEC, isProfile, isWorkload, PROFILES, WORKLOADS } from '../src/protocol/forkWars.js'
import { machineFacts, runPair } from './_lib/benchRun.js'
import { HttpError, json, rateLimit, readJson, route } from './_lib/http.js'

const bodySchema = z.object({
  left: z.string().refine(isProfile, 'Unknown left profile'),
  right: z.string().refine(isProfile, 'Unknown right profile'),
  workload: z.string().refine(isWorkload, 'Unknown workload'),
  count: z.number().int().min(BENCH_COUNT_MIN).max(BENCH_COUNT_MAX),
}).strict()

const METHODOLOGY = 'Each side is a fresh Anvil process bound to 127.0.0.1. The same transactions are sent to both, signed by Anvil\'s public development account. Latency is wall-clock time from send to receipt. Throughput is successful transactions divided by that side\'s elapsed time. Gas is the receipt gas. CPU and RSS come from ps samples of that Anvil process about every 200 ms. No figure is filled in when the sample is missing.'

/** Local Fork Wars runner. Production hosts do not start Anvil. */
export const { GET, POST } = route('benchmarks', {
  async GET(context) {
    await rateLimit(context, 'read', 60)
    return json({
      available: context.env.dev,
      spec: FORK_WARS_SPEC,
      profiles: Object.entries(PROFILES).map(([id, profile]) => ({ id, label: profile.label, detail: profile.detail, args: profile.args })),
      workloads: WORKLOADS,
      count: { min: BENCH_COUNT_MIN, max: BENCH_COUNT_MAX },
      reason: context.env.dev ? null : 'This server does not start Anvil. Fork Wars runs on a local machine.',
    })
  },
  async POST(context) {
    if (!context.env.dev) throw new HttpError(501, 'LOCAL_ONLY', 'This server does not start Anvil. Fork Wars runs on a local machine.')
    await rateLimit(context, 'benchmark', 2, 60)
    const body = await readJson(context, bodySchema)
    try {
      const sides = await runPair(body.left, body.right, body.workload, body.count)
      return json({
        spec: FORK_WARS_SPEC,
        workload: body.workload,
        count: body.count,
        startedAt: new Date().toISOString(),
        sides: sides.map((side) => ({ ...side, samples: side.samples.map((sample) => ({ ...sample, gasUsed: sample.gasUsed.toString() })), summary: { ...side.summary, totalGas: side.summary.totalGas.toString(), meanGas: side.summary.meanGas?.toString() ?? null } })),
        methodology: METHODOLOGY,
        machine: machineFacts(),
      })
    } catch (cause) {
      throw new HttpError(409, 'BENCH_FAILED', cause instanceof Error ? cause.message : 'The benchmark did not finish.')
    }
  },
})
