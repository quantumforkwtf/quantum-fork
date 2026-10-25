import { GitBranch, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useDnaLibrary } from '../lib/dnaLibrary'
import { usePageMeta } from '../lib/meta'
import { removeLineage, saveLineage, useLineages } from '../lib/mutationLibrary'
import { defaultDna, FIELDS, getPath, retarget, type Target, TARGETS } from '../protocol/chainDna'
import { branchLineage, extendLineage, isTip, type Lineage, type MutationEffect, planUpgrade, revisionHistory, rollbackLineage, seedLineage } from '../protocol/mutation'
import { Link } from '../router'

const EFFECT: Record<MutationEffect, string> = {
  identity: 'Label',
  contract: 'Contract',
  'built-in': 'Already there',
  'local-anvil': 'Local Anvil',
  'dedicated-chain': 'Needs a chain',
  research: 'Research',
  impossible: 'Not possible here',
}

function writePath(dna: ReturnType<typeof defaultDna>, path: string, value: unknown) {
  const next = structuredClone(dna) as unknown as Record<string, unknown>
  const keys = path.split('.')
  let cursor = next
  for (const key of keys.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>
  cursor[keys[keys.length - 1]] = value
  return next as ReturnType<typeof defaultDna>
}

export default function Mutation() {
  usePageMeta({ title: 'Mutation Engine', description: 'Version and branch Chain DNA. Contract changes stay separate from anything that would need its own chain. Base consensus is never edited from here.', path: '/lab/mutation' })
  const lineages = useLineages()
  const library = useDnaLibrary()
  const [lineageId, setLineageId] = useState<string | null>(null)
  const [revisionId, setRevisionId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ReturnType<typeof defaultDna> | null>(null)
  const [branch, setBranch] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lineage = lineages.find((item) => item.id === lineageId) ?? lineages[0] ?? null
  const selected = lineage?.revisions.find((item) => item.id === revisionId) ?? lineage?.revisions.at(-1) ?? null

  useEffect(() => {
    if (selected) setDraft(structuredClone(selected.dna))
  }, [selected])

  const recorded = useMemo(() => {
    if (!lineage || !selected?.parentId) return null
    const parent = lineage.revisions.find((item) => item.id === selected.parentId)
    return parent ? planUpgrade(parent.dna, selected.dna, selected.note.toLowerCase().includes('roll back') ? 'rollback' : 'upgrade') : null
  }, [lineage, selected])
  const preview = useMemo(() => (selected && draft ? planUpgrade(selected.dna, draft) : null), [selected, draft])
  const history = lineage && selected ? revisionHistory(lineage, selected.id) : []
  const depth = lineage ? Math.max(...lineage.revisions.map((item) => item.version)) : 0

  function commit(next: Lineage) {
    saveLineage(next)
    setLineageId(next.id)
    setRevisionId(next.revisions.at(-1)?.id ?? null)
    setBranch('')
    setNote('')
    setError(null)
  }

  function record(kind: 'extend' | 'branch' | 'rollback') {
    if (!lineage || !selected || !draft) return
    try {
      const at = new Date().toISOString()
      const next = kind === 'extend' ? extendLineage(lineage, selected.id, draft, note, at) : kind === 'branch' ? branchLineage(lineage, selected.id, draft, branch.trim(), note, at) : rollbackLineage(lineage, selected.id, branch.trim(), note, at)
      commit(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The branch was not recorded.')
    }
  }

  return (
    <div className="gs mu">
      <header className="gs-head">
        <div>
          <p className="eyebrow"><Link to="/lab">Lab</Link> · Mutation Engine</p>
          <h1>Versions of a chain, on paper.</h1>
          <p className="section-lede">Each node is a Chain DNA configuration. Branching records an alternative. A contract change is marked as a contract change. Anything that would need its own chain, or that Base itself decides, is marked that way. Nothing on this page is deployed.</p>
        </div>
      </header>

      {!lineage && (
        <section className="gs-panel">
          <p className="mono-label">Start a lineage</p>
          <div className="rf-row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => commit(seedLineage(defaultDna('base'), 'Contracts on Base.'))}>Base contracts</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => commit(seedLineage(defaultDna('local-devnet'), 'A local Anvil devnet.'))}>Local devnet</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => commit(seedLineage(defaultDna('op-stack'), 'A dedicated rollup. Provisioning is not available.'))}>Dedicated rollup</button>
          </div>
          {library.length > 0 && (
            <div className="rf-row">
              {library.slice(0, 6).map((item) => (
                <button key={item.id} type="button" className="btn btn-quiet btn-sm" onClick={() => commit(seedLineage(item.dna, 'Imported from this browser.'))}>{item.dna.name}</button>
              ))}
            </div>
          )}
        </section>
      )}

      {lineage && selected && draft && (
        <>
          <section className="gs-panel">
            <div className="rf-row">
              <label className="mf-field"><span>Lineage</span>
                <select className="input" value={lineage.id} onChange={(event) => { setLineageId(event.target.value); setRevisionId(null) }}>
                  {lineages.map((item) => <option key={item.id} value={item.id}>{item.revisions[0]?.dna.name} · {item.revisions.length} revisions</option>)}
                </select>
              </label>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => { removeLineage(lineage.id); setLineageId(null); setRevisionId(null) }}>Delete this tree</button>
            </div>
            <div className="mu-tree" role="tree" aria-label="Configuration history">
              {Array.from({ length: depth }, (_, index) => (
                <ol key={index}>
                  {lineage.revisions.filter((item) => item.version === index + 1).map((item) => (
                    <li key={item.id}>
                      <button type="button" className={item.id === selected.id ? 'is-on' : undefined} onClick={() => setRevisionId(item.id)}>
                        <b>{item.branch} · v{item.version}</b>
                        <small>{item.dna.name}</small>
                        <small>{TARGETS[item.dna.target].short}</small>
                      </button>
                    </li>
                  ))}
                </ol>
              ))}
            </div>
            <p className="mf-hint">{history.map((item) => `${item.branch} v${item.version}`).join(' → ')} · <code>{selected.hash.slice(0, 14)}…</code></p>
          </section>

          {recorded && <Plan title="What this revision changed" plan={recorded} />}

          <section className="gs-panel">
            <p className="mono-label">Draft the next revision</p>
            <div className="mu-fields">
              <label className="mf-field"><span>Name</span><input className="input" value={draft.name} onChange={(event) => setDraft(writePath(draft, 'name', event.target.value))} /></label>
              <label className="mf-field"><span>Target</span>
                <select className="input" value={draft.target} onChange={(event) => setDraft(retarget(draft, event.target.value as Target))}>
                  {(Object.keys(TARGETS) as Target[]).map((target) => <option key={target} value={target}>{TARGETS[target].label}</option>)}
                </select>
              </label>
              <label className="mf-field"><span>Chain ID</span><input className="input" inputMode="numeric" value={draft.network.chainId} onChange={(event) => setDraft(writePath(draft, 'network.chainId', Number(event.target.value) || draft.network.chainId))} /></label>
              <label className="mf-field"><span>Block time (ms)</span><input className="input" inputMode="numeric" value={draft.network.blockTimeMs} onChange={(event) => setDraft(writePath(draft, 'network.blockTimeMs', Number(event.target.value.replace(/\D/g, '')) || 0))} /></label>
              {FIELDS.map((field) => {
                const current = getPath(draft, field.path)
                if (field.multi) {
                  const chosen = new Set((current as string[]) ?? [])
                  return (
                    <fieldset key={field.path} className="mf-field mu-multi">
                      <legend>{field.label}</legend>
                      {Object.entries(field.options).map(([value, option]) => (
                        <label key={value}><input type="checkbox" checked={chosen.has(value)} onChange={() => {
                          const next = new Set(chosen)
                          if (next.has(value)) next.delete(value)
                          else next.add(value)
                          setDraft(writePath(draft, field.path, [...next].sort()))
                        }} /> {option.label}</label>
                      ))}
                    </fieldset>
                  )
                }
                return (
                  <label key={field.path} className="mf-field"><span>{field.label}</span>
                    <select className="input" value={current == null ? '' : String(current)} onChange={(event) => setDraft(writePath(draft, field.path, event.target.value || null))}>
                      {current == null && <option value="">—</option>}
                      {Object.entries(field.options).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
                    </select>
                  </label>
                )
              })}
            </div>
            <div className="rf-row">
              <label className="mf-field"><span>Branch name</span><input className="input" value={branch} placeholder="west" onChange={(event) => setBranch(event.target.value.toLowerCase())} /></label>
              <label className="mf-field mu-note"><span>Note</span><input className="input" value={note} onChange={(event) => setNote(event.target.value)} /></label>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!isTip(lineage, selected.id)} onClick={() => record('extend')}>Extend {selected.branch}</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => record('branch')}><GitBranch size={14} strokeWidth={1.8} /> Branch</button>
              <button type="button" className="btn btn-quiet btn-sm" disabled={!selected.parentId} onClick={() => record('rollback')}><Undo2 size={14} strokeWidth={1.8} /> Record rollback</button>
            </div>
            {error && <p className="callout is-warn">{error}</p>}
          </section>
          {preview && <Plan title="Plan for this draft" plan={preview} />}
        </>
      )}
      <p className="gs-fine">A smart contract on Base can change contract code you deploy. It cannot change Base's sequencer, block time, gas limit, base fee, or the EVM. A dedicated rollup is a different chain, and provisioning one is not available. Local Anvil settings exist only on this machine.</p>
    </div>
  )
}

function Plan({ title, plan }: { title: string; plan: ReturnType<typeof planUpgrade> }) {
  return (
    <section className="gs-panel">
      <p className="mono-label">{title} · {plan.applicable ? 'applicable as written' : plan.changes.length ? 'not applicable' : 'no difference'}</p>
      <p className="mf-hint">{plan.summary}</p>
      {plan.changes.length > 0 && (
        <table className="gs-table">
          <thead><tr><th>Change</th><th>From</th><th>To</th><th>Kind</th></tr></thead>
          <tbody>
            {plan.changes.map((change, index) => (
              <tr key={`${change.path}-${index}`}><td>{change.label}</td><td><code>{change.from}</code></td><td><code>{change.to}</code></td><td><span className={`mu-effect is-${change.effect}`}>{EFFECT[change.effect]}</span><small>{change.detail}</small></td></tr>
            ))}
          </tbody>
        </table>
      )}
      {plan.issues.length > 0 && <ul className="gs-infra">{plan.issues.map((issue) => <li key={issue.path + issue.message}><span>{issue.level}</span><small>{issue.message}</small></li>)}</ul>}
      {(plan.anvilBefore || plan.anvilAfter) && (
        <div className="rf-pair">
          {plan.anvilBefore && <pre className="gs-command">{plan.anvilBefore}</pre>}
          {plan.anvilAfter && <pre className="gs-command">{plan.anvilAfter}</pre>}
        </div>
      )}
    </section>
  )
}
