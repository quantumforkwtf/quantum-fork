import { Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePageMeta } from '../lib/meta'
import { GHOST_LIFETIMES, type GhostLifetime } from '../protocol/ghostChain'
import { Link } from '../router'

interface GhostView {
  id: string
  chainId: number
  port: number
  lifetime: GhostLifetime
  status: string
  remainingMs: number
  rpc: string
  blockNumber: number | null
  transactions: { total: number; fromBlock: number } | null
  rpcOk: boolean
  rssKb: number | null
  accounts: string[]
  logs: string[]
  error: string | null
}

function left(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${rest}s`
  return `${rest}s`
}

export default function GhostChains() {
  usePageMeta({ title: 'Ghost Chains', description: 'Temporary Anvil networks on this machine, with a real lifetime, a loopback RPC, and metrics read from the node.', path: '/lab/ghost-chains' })
  const [available, setAvailable] = useState<boolean | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [lifetime, setLifetime] = useState<GhostLifetime>('15m')
  const [environments, setEnvironments] = useState<GhostView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const response = await fetch('/api/ghosts')
    const body = await response.json()
    setAvailable(Boolean(body.available))
    setReason(body.reason ?? null)
    setEnvironments(body.environments ?? [])
  }

  useEffect(() => {
    void refresh().catch(() => setReason('The environment runner did not answer.'))
    const timer = setInterval(() => { void refresh().catch(() => undefined) }, 3000)
    return () => clearInterval(timer)
  }, [])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/ghosts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', lifetime }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error?.message ?? 'The environment did not start.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The environment did not start.')
    } finally {
      setBusy(false)
    }
  }

  async function terminate(id: string) {
    setError(null)
    const response = await fetch('/api/ghosts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'terminate', id }) })
    const body = await response.json()
    if (!response.ok) setError(body?.error?.message ?? 'The environment did not stop.')
    await refresh()
  }

  async function snapshot(id: string) {
    const response = await fetch('/api/ghosts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'snapshot', id }) })
    const body = await response.json()
    if (!response.ok) return setError(body?.error?.message ?? 'Anvil did not return a snapshot.')
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${id}-state.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="gs">
      <header className="gs-head">
        <div>
          <p className="eyebrow"><Link to="/lab">Lab</Link> · Ghost Chains · this machine</p>
          <h1>A chain with an ending.</h1>
          <p className="section-lede">Each environment is an Anvil process on 127.0.0.1. It has its own chain id, a clock, and it is killed when the time runs out. Nothing here is reachable from the public internet.</p>
        </div>
      </header>
      <section className="gs-panel">
        <div className="rf-row">
          <label className="mf-field"><span>Lifetime</span>
            <select className="input" value={lifetime} onChange={(event) => setLifetime(event.target.value as GhostLifetime)}>
              {Object.keys(GHOST_LIFETIMES).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || available === false} onClick={() => void create()}>{busy ? 'Starting…' : 'Create'}</button>
        </div>
        <p className="mf-hint">Two environments at a time. The RPC is loopback only. Restarting the dev server forgets them and the processes are killed with it.</p>
        {available === false && <p className="callout is-warn">{reason}</p>}
        {error && <p className="callout is-warn">{error}</p>}
      </section>
      {environments.length === 0 && <p className="mf-hint">No environments on this machine.</p>}
      <div className="rf-pair">
        {environments.map((env) => (
          <section key={env.id} className="gs-panel">
            <p className="mono-label">{env.status} · {env.id}</p>
            <dl className="gs-hashes">
              <div><dt>Chain</dt><dd>{env.chainId}</dd></div>
              <div><dt>Time left</dt><dd>{left(env.remainingMs)}</dd></div>
              <div><dt>Block</dt><dd>{env.blockNumber ?? '—'}</dd></div>
              <div><dt>Transactions</dt><dd>{env.transactions ? env.transactions.total : '—'}</dd></div>
              <div><dt>RPC</dt><dd>{env.rpcOk ? 'answering' : 'not answering'} · {env.rpc}</dd></div>
              <div><dt>RSS</dt><dd>{env.rssKb == null ? '—' : `${(env.rssKb / 1024).toFixed(1)} MB`}</dd></div>
              <div><dt>Accounts</dt><dd>{env.accounts.length}</dd></div>
            </dl>
            {env.accounts.length > 0 && <p className="mf-hint">{env.accounts.join(' · ')}</p>}
            {env.logs.length > 0 && <pre className="gs-command">{env.logs.slice(-6).join('\n')}</pre>}
            <div className="rf-row">
              {env.status === 'RUNNING' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void snapshot(env.id)}>Snapshot</button>}
              {env.status !== 'TERMINATED' && <button type="button" className="btn btn-quiet btn-sm" onClick={() => void terminate(env.id)}><Square size={14} strokeWidth={1.8} /> Terminate</button>}
            </div>
          </section>
        ))}
      </div>
      <p className="gs-fine">Hosted Ghost Chains need an isolated machine per environment. This page is the local version. A terminated environment is gone; the snapshot is the only thing kept, and only if you downloaded it.</p>
    </div>
  )
}
