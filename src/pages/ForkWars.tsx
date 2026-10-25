import { Download, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePageMeta } from '../lib/meta'
import { PROFILES, WORKLOADS, type ProfileId, type WorkloadId } from '../protocol/forkWars'
import { Link } from '../router'

interface PublicSample {
  label: string
  status: 'success' | 'reverted' | 'rejected'
  gasUsed: string
  latencyMs: number
  error: string | null
}

interface PublicSide {
  profile: ProfileId
  summary: { transactions: number; succeeded: number; failed: number; failureRate: number; totalGas: string; meanGas: string | null; meanLatencyMs: number | null; elapsedMs: number; throughputPerSec: number | null }
  resources?: { peakRssKb: number; meanCpuPercent: number | null; observations: number }
  samples: PublicSample[]
}

interface PublicReport {
  workload: WorkloadId
  count: number
  startedAt: string
  methodology: string
  machine?: { platform: string; arch: string; cpuModel: string | null; cpus: number; node: string; anvil: string | null }
  sides: PublicSide[]
}

const NAMES: Record<WorkloadId, string> = { erc20: 'ERC-20 transfers', erc721: 'ERC-721 transfers', deploy: 'Contract deployment', storage: 'Storage writes', compute: 'Hash loop', mixed: 'Mixed' }

export default function ForkWars() {
  usePageMeta({ title: 'Fork Wars', description: 'Run the same transactions on two local Anvil configurations and compare measured gas, latency, throughput and process usage.', path: '/lab/fork-wars' })
  const [available, setAvailable] = useState<boolean | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [left, setLeft] = useState<ProfileId>('automine')
  const [right, setRight] = useState<ProfileId>('interval')
  const [workload, setWorkload] = useState<WorkloadId>('erc20')
  const [count, setCount] = useState(4)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<PublicReport | null>(null)

  useEffect(() => {
    fetch('/api/benchmarks').then((response) => response.json()).then((body: { available?: boolean; reason?: string | null }) => {
      setAvailable(Boolean(body.available))
      setReason(body.reason ?? null)
    }).catch(() => { setAvailable(false); setReason('The benchmark runner did not answer.') })
  }, [])

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/benchmarks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ left, right, workload, count }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error?.message ?? 'The benchmark did not finish.')
      setReport(body as PublicReport)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The benchmark did not finish.')
    } finally {
      setBusy(false)
    }
  }

  function download() {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `fork-wars-${report.workload}-${report.count}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const peak = report ? Math.max(1, ...report.sides.flatMap((side) => side.samples.map((sample) => sample.latencyMs))) : 1

  return (
    <div className="gs fw">
      <header className="gs-head">
        <div>
          <p className="eyebrow"><Link to="/lab">Lab</Link> · Fork Wars · local Anvil</p>
          <h1>Two chains, one workload.</h1>
          <p className="section-lede">The same transactions run on two fresh Anvil nodes. Gas, latency, throughput and the Anvil process's memory come from that run.</p>
        </div>
      </header>
      <section className="gs-panel">
        <div className="rf-row">
          <label className="mf-field"><span>Left</span>
            <select className="input" value={left} onChange={(event) => setLeft(event.target.value as ProfileId)}>{Object.entries(PROFILES).map(([id, profile]) => <option key={id} value={id}>{profile.label}</option>)}</select>
          </label>
          <label className="mf-field"><span>Right</span>
            <select className="input" value={right} onChange={(event) => setRight(event.target.value as ProfileId)}>{Object.entries(PROFILES).map(([id, profile]) => <option key={id} value={id}>{profile.label}</option>)}</select>
          </label>
          <label className="mf-field"><span>Workload</span>
            <select className="input" value={workload} onChange={(event) => setWorkload(event.target.value as WorkloadId)}>{WORKLOADS.map((id) => <option key={id} value={id}>{NAMES[id]}</option>)}</select>
          </label>
          <label className="mf-field"><span>Transactions</span>
            <input className="input" inputMode="numeric" value={count} onChange={(event) => setCount(Number(event.target.value.replace(/\D/g, '')) || 4)} />
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || available === false} onClick={() => void run()}><Play size={14} strokeWidth={1.8} /> {busy ? 'Running…' : 'Run'}</button>
          {report && <button type="button" className="btn btn-secondary btn-sm" onClick={download}><Download size={14} strokeWidth={1.8} /> Report</button>}
        </div>
        <p className="mf-hint">{PROFILES[left].detail} Against: {PROFILES[right].detail}</p>
        {available === false && <p className="callout is-warn">{reason}</p>}
      </section>
      {busy && <p className="callout">Starting two Anvil nodes and sending the workload. The bars appear when both sides have receipts.</p>}
      {error && <p className="callout is-warn">{error}</p>}
      {report && (
        <>
          <div className="rf-pair">
            {report.sides.map((side) => (
              <section key={side.profile + side.summary.elapsedMs} className="gs-panel">
                <p className="mono-label">{PROFILES[side.profile].label}</p>
                <dl className="gs-hashes">
                  <div><dt>Throughput</dt><dd>{side.summary.throughputPerSec == null ? '—' : `${side.summary.throughputPerSec.toFixed(2)} tx/s`}</dd></div>
                  <div><dt>Mean latency</dt><dd>{side.summary.meanLatencyMs == null ? '—' : `${Math.round(side.summary.meanLatencyMs)} ms`}</dd></div>
                  <div><dt>Gas</dt><dd>{side.summary.totalGas}</dd></div>
                  <div><dt>Failed</dt><dd>{side.summary.failed} / {side.summary.transactions}</dd></div>
                  <div><dt>Peak RSS</dt><dd>{side.resources ? `${(side.resources.peakRssKb / 1024).toFixed(1)} MB` : 'not sampled'}</dd></div>
                  <div><dt>Mean CPU</dt><dd>{side.resources?.meanCpuPercent == null ? 'not sampled' : `${side.resources.meanCpuPercent.toFixed(1)}%`}</dd></div>
                </dl>
                <ol className="fw-race">
                  {side.samples.map((sample, index) => (
                    <li key={index}><span style={{ width: `${Math.max(4, (sample.latencyMs / peak) * 100)}%` }} className={sample.status === 'success' ? 'is-ok' : 'is-bad'} /><small>{sample.label} · {sample.latencyMs} ms · {sample.gasUsed} gas</small></li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          <section className="gs-panel">
            <p className="mono-label">How this was measured</p>
            <p className="mf-hint">{report.methodology}</p>
            {report.machine && <p className="mf-hint">{report.machine.anvil ?? 'Anvil version unread'} · {report.machine.cpuModel ?? 'CPU unread'} · {report.machine.cpus} cores · {report.machine.platform}/{report.machine.arch} · Node {report.machine.node}</p>}
          </section>
        </>
      )}
      <p className="gs-fine">These nodes are not Base. A one-second block interval is slower on purpose. CPU is the percentage ps reports for the Anvil process, not a capacity number, and a short run can read 0. Nothing here is a network TPS claim.</p>
    </div>
  )
}
