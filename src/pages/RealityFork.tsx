import { Copy, Download, FileUp, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { type ChangeEvent, useMemo, useRef, useState } from 'react'
import { encodeFunctionData, formatEther, type Hex, parseAbiItem, parseEther } from 'viem'
import { ForkRpcError, forkMetadata, forkRpc, realBlock } from '../lib/evm/forkRpc'
import { usePageMeta } from '../lib/meta'
import { copyText, toast } from '../lib/toast'
import { useLocation } from '../navigation'
import { shortAddress } from '../protocol/address'
import { BASE_EXPLORER, type BaseNetwork } from '../protocol/base'
import {
  type AnvilMetadata,
  checkForkIdentity,
  compareRuns,
  DEFAULT_PORTS,
  FORK_SPEC,
  forkCommands,
  type IdentityIssue,
  MAX_CALLS,
  MAX_MODIFICATIONS,
  parseScenario,
  type RunResult,
  runOnFork,
  type Scenario,
} from '../protocol/realityFork'
import { Link } from '../router'

type Side = 'original' | 'modified'
type ModDraft = { kind: 'code' | 'storage' | 'balance'; address: string; code: string; slot: string; value: string; eth: string }
type CallDraft = { label: string; from: string; to: string; data: string; eth: string; gas: string }
type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok'; metadata: AnvilMetadata } | { state: 'failed'; message: string; issues?: IdentityIssue[] }

const NETWORK_LABEL: Record<BaseNetwork, string> = { base: 'Base', 'base-sepolia': 'Base Sepolia' }
const blankMod = (): ModDraft => ({ kind: 'code', address: '', code: '0x', slot: '0x0', value: '0x0', eth: '1' })
const blankCall = (): CallDraft => ({ label: '', from: '0x000000000000000000000000000000000000dEaD', to: '', data: '0x', eth: '0', gas: '3000000' })

function toScenario(source: BaseNetwork, block: string, fundSenders: boolean, mods: ModDraft[], calls: CallDraft[]) {
  const value = (eth: string) => {
    try {
      return parseEther(eth.trim() || '0').toString()
    } catch {
      return 'invalid'
    }
  }
  return parseScenario({
    spec: FORK_SPEC,
    source,
    block: Number(block),
    fundSenders,
    modifications: mods.map((mod) =>
      mod.kind === 'code' ? { kind: 'code', address: mod.address.trim(), code: mod.code.trim() } : mod.kind === 'storage' ? { kind: 'storage', address: mod.address.trim(), slot: mod.slot.trim(), value: mod.value.trim() } : { kind: 'balance', address: mod.address.trim(), wei: value(mod.eth) },
    ),
    calls: calls.map((call) => ({ label: call.label, from: call.from.trim(), to: call.to.trim(), data: call.data.trim() || '0x', valueWei: value(call.eth), gas: Number(call.gas) })),
  })
}

function fromScenario(scenario: Scenario) {
  return {
    mods: scenario.modifications.map((mod): ModDraft => ({ ...blankMod(), kind: mod.kind, address: mod.address, ...(mod.kind === 'code' ? { code: mod.code } : mod.kind === 'storage' ? { slot: mod.slot, value: mod.value } : { eth: formatEther(BigInt(mod.wei)) }) })),
    calls: scenario.calls.map((call): CallDraft => ({ label: call.label, from: call.from, to: call.to, data: call.data, eth: formatEther(BigInt(call.valueWei)), gas: String(call.gas) })),
  }
}

export default function RealityFork() {
  usePageMeta({ title: 'Reality Fork', description: 'Run the same transactions on two local Anvil forks of one Base block, change one of them, and compare receipts, call traces and state.', path: '/lab/reality-fork' })
  const { query } = useLocation()
  const [source, setSource] = useState<BaseNetwork>(query.get('source') === 'base' ? 'base' : 'base-sepolia')
  const [block, setBlock] = useState(/^\d+$/.test(query.get('block') ?? '') ? (query.get('block') as string) : '')
  const [urls, setUrls] = useState<Record<Side, string>>({ original: `http://127.0.0.1:${DEFAULT_PORTS.original}`, modified: `http://127.0.0.1:${DEFAULT_PORTS.modified}` })
  const [checks, setChecks] = useState<Record<Side, Check>>({ original: { state: 'idle' }, modified: { state: 'idle' } })
  const [realHash, setRealHash] = useState<Hex | null>(null)
  const [fundSenders, setFundSenders] = useState(true)
  const [mods, setMods] = useState<ModDraft[]>([blankMod()])
  const [calls, setCalls] = useState<CallDraft[]>([blankCall()])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<{ original: RunResult; modified: RunResult; scenario: Scenario } | null>(null)
  const [onlyDifferences, setOnlyDifferences] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)

  const blockNumber = /^\d+$/.test(block) ? Number(block) : null
  const commands = blockNumber ? forkCommands(source, blockNumber) : null
  const parsed = useMemo(() => toScenario(source, block, fundSenders, mods, calls), [source, block, fundSenders, mods, calls])
  const verified = checks.original.state === 'ok' && checks.modified.state === 'ok'
  const rows = useMemo(() => (results ? compareRuns(results.original, results.modified) : []), [results])
  const shown = onlyDifferences ? rows.filter((row) => row.differs) : rows

  const resetChecks = () => {
    setChecks({ original: { state: 'idle' }, modified: { state: 'idle' } })
    setResults(null)
  }

  async function loadFinalized() {
    setBusy('block')
    setError(null)
    try {
      const head = await realBlock(source, 'finalized')
      setBlock(String(head.number))
      setRealHash(head.hash)
      resetChecks()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the latest finalized block.')
    } finally {
      setBusy(null)
    }
  }

  async function checkForks() {
    if (!blockNumber) return
    setBusy('check')
    setError(null)
    setResults(null)
    setChecks({ original: { state: 'checking' }, modified: { state: 'checking' } })
    let hash = realHash
    try {
      hash = (await realBlock(source, blockNumber)).hash
      setRealHash(hash)
    } catch (cause) {
      setError(`Could not read block ${blockNumber} from ${NETWORK_LABEL[source]} to compare hashes: ${cause instanceof Error ? cause.message : 'unknown error'}`)
      setChecks({ original: { state: 'idle' }, modified: { state: 'idle' } })
      setBusy(null)
      return
    }
    const next = {} as Record<Side, Check>
    const ids = new Set<string>()
    for (const side of ['original', 'modified'] as const) {
      try {
        const metadata = await forkMetadata(forkRpc(urls[side]))
        const issues = checkForkIdentity(metadata, { source, block: blockNumber, blockHash: hash })
        if (ids.has(metadata.instanceId)) issues.push({ code: 'NOT_A_FORK', message: 'Both URLs reach the same Anvil node. Start two nodes on different ports.' })
        ids.add(metadata.instanceId)
        next[side] = issues.length ? { state: 'failed', message: issues[0].message, issues } : { state: 'ok', metadata }
      } catch (cause) {
        next[side] = { state: 'failed', message: cause instanceof ForkRpcError || cause instanceof Error ? cause.message : 'Unreachable.' }
      }
    }
    setChecks(next)
    setBusy(null)
  }

  async function run() {
    if (!parsed.ok || !verified) return
    setBusy('run')
    setError(null)
    try {
      const [original, modified] = await Promise.all([runOnFork(forkRpc(urls.original), parsed.scenario, false), runOnFork(forkRpc(urls.modified), parsed.scenario, true)])
      setResults({ original, modified, scenario: parsed.scenario })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The run failed.')
    } finally {
      setBusy(null)
    }
  }

  function exportScenario() {
    if (!parsed.ok) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(parsed.scenario, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `reality-fork-${parsed.scenario.block}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importScenario(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 256 * 1024) return setError('That file is larger than 256 KB.')
    try {
      const result = parseScenario(JSON.parse(await file.text()))
      if (!result.ok) return setError(`Not a Reality Fork scenario: ${result.issues[0]}`)
      const drafts = fromScenario(result.scenario)
      setSource(result.scenario.source)
      setBlock(String(result.scenario.block))
      setFundSenders(result.scenario.fundSenders)
      setMods(drafts.mods)
      setCalls(drafts.calls)
      resetChecks()
      toast('Scenario imported.')
    } catch {
      setError('That file is not valid JSON.')
    }
  }

  return (
    <div className="gs rf">
      <header className="gs-head">
        <div>
          <p className="eyebrow">
            <Link to="/lab">Lab</Link> · Reality Fork · runs locally
          </p>
          <h1>Run it twice. Change one thing.</h1>
          <p className="section-lede">
            Two Anvil forks of the same {NETWORK_LABEL[source]} block run on your machine. The same transactions go to both; only the right-hand fork gets your changes. Receipts, call traces and state changes come from the nodes themselves.
          </p>
        </div>
        <div className="gs-actions">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => fileInput.current?.click()}>
            <FileUp size={14} strokeWidth={1.8} /> Import
          </button>
          <button type="button" className="btn btn-quiet btn-sm" disabled={!parsed.ok} onClick={exportScenario}>
            <Download size={14} strokeWidth={1.8} /> Export
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importScenario(event)} />
        </div>
      </header>

      <p className="callout rf-banner">
        <b>FORK, NOT BASE.</b> Nothing on this page sends a transaction to {NETWORK_LABEL[source]}. Senders are impersonated, so no wallet signs anything. Balances and tokens on a fork are not real and cannot be moved to the real network.
      </p>

      <ol className="rf-steps">
        <li className="gs-panel">
          <p className="mono-label">1 · Fork point</p>
          <div className="rf-row">
            <label className="mf-field">
              <span>Network</span>
              <select
                className="input"
                value={source}
                onChange={(event) => {
                  setSource(event.target.value as BaseNetwork)
                  setRealHash(null)
                  resetChecks()
                }}
              >
                <option value="base-sepolia">Base Sepolia</option>
                <option value="base">Base</option>
              </select>
            </label>
            <label className="mf-field">
              <span>Block</span>
              <input
                className="input"
                inputMode="numeric"
                value={block}
                placeholder="e.g. 32000000"
                onChange={(event) => {
                  setBlock(event.target.value.replace(/\D/g, ''))
                  setRealHash(null)
                  resetChecks()
                }}
              />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy === 'block'} onClick={() => void loadFinalized()}>
              <RefreshCw size={14} strokeWidth={1.8} /> Latest finalized
            </button>
          </div>
          {commands ? (
            <>
              <p className="mf-hint">Start both in separate terminals. The public endpoint is rate-limited; pass your own RPC URL to --fork-url for heavier use.</p>
              {(['original', 'modified'] as const).map((side) => (
                <div key={side} className="rf-command">
                  <span className="mono-label">{side === 'original' ? 'Original' : 'Modified'}</span>
                  <pre className="gs-command">{commands[side]}</pre>
                  <button type="button" className="icon-btn" aria-label={`Copy the ${side} command`} onClick={() => void copyText(commands[side]).then(() => toast('Command copied.'))}>
                    <Copy size={14} strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </>
          ) : (
            <p className="muted">Choose a block to fork. Finalized blocks never change, so both forks start from identical state.</p>
          )}
        </li>

        <li className="gs-panel">
          <p className="mono-label">2 · Connect and verify</p>
          <div className="rf-pair">
            {(['original', 'modified'] as const).map((side) => {
              const check = checks[side]
              return (
                <div key={side} className={`rf-node is-${check.state}`}>
                  <label className="mf-field">
                    <span>{side === 'original' ? 'Original fork' : 'Modified fork'}</span>
                    <input
                      className="input"
                      value={urls[side]}
                      onChange={(event) => {
                        setUrls({ ...urls, [side]: event.target.value })
                        resetChecks()
                      }}
                    />
                  </label>
                  {check.state === 'ok' && (
                    <small>
                      {check.metadata.clientVersion} · fork of block {check.metadata.forkedNetwork?.forkBlockNumber.toLocaleString('en-US')} · hash matches {NETWORK_LABEL[source]}
                    </small>
                  )}
                  {check.state === 'failed' && <small className="field-error">{check.message}</small>}
                  {check.state === 'checking' && <small className="muted">Checking…</small>}
                </div>
              )
            })}
          </div>
          <div className="rf-row">
            <button type="button" className="btn btn-secondary btn-sm" disabled={!blockNumber || busy === 'check'} onClick={() => void checkForks()}>
              Check both forks
            </button>
            {realHash && blockNumber && (
              <a className="mf-hint" href={`${BASE_EXPLORER[source]}/block/${blockNumber}`} target="_blank" rel="noreferrer">
                Block {blockNumber.toLocaleString('en-US')} on {NETWORK_LABEL[source]}: {shortAddress(realHash, 8, 6)}
              </a>
            )}
          </div>
          <p className="mf-hint">Each node must be Anvil, forked from {NETWORK_LABEL[source]} at exactly this block, with the same block hash the real network reports.</p>
        </li>

        <li className="gs-panel">
          <p className="mono-label">3 · Changes to the modified fork · {mods.length}/{MAX_MODIFICATIONS}</p>
          {mods.map((mod, index) => (
            <ModEditor key={index} mod={mod} onChange={(next) => setMods(mods.map((item, at) => (at === index ? next : item)))} onRemove={() => setMods(mods.filter((_, at) => at !== index))} />
          ))}
          <button type="button" className="btn btn-quiet btn-sm" disabled={mods.length >= MAX_MODIFICATIONS} onClick={() => setMods([...mods, blankMod()])}>
            <Plus size={14} strokeWidth={1.8} /> Add a change
          </button>
        </li>

        <li className="gs-panel">
          <p className="mono-label">4 · Transactions, sent to both · {calls.length}/{MAX_CALLS}</p>
          {calls.map((call, index) => (
            <CallEditor key={index} index={index} call={call} onChange={(next) => setCalls(calls.map((item, at) => (at === index ? next : item)))} onRemove={calls.length > 1 ? () => setCalls(calls.filter((_, at) => at !== index)) : undefined} />
          ))}
          <div className="rf-row">
            <button type="button" className="btn btn-quiet btn-sm" disabled={calls.length >= MAX_CALLS} onClick={() => setCalls([...calls, blankCall()])}>
              <Plus size={14} strokeWidth={1.8} /> Add a transaction
            </button>
            <label className="rf-check">
              <input type="checkbox" checked={fundSenders} onChange={(event) => setFundSenders(event.target.checked)} /> Give each sender 10 ETH on both forks first
            </label>
          </div>
        </li>
      </ol>

      {!parsed.ok && (
        <ul className="dna-issues">
          {parsed.issues.slice(0, 4).map((issue) => (
            <li key={issue} className="is-error">
              <b>Fix</b>
              {issue}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="callout is-warn">{error}</p>}

      <div className="rf-row rf-run">
        <button type="button" className="btn btn-primary" disabled={!parsed.ok || !verified || busy === 'run'} onClick={() => void run()}>
          <Play size={15} strokeWidth={1.8} /> {busy === 'run' ? 'Running on both forks…' : 'Run on both forks'}
        </button>
        <span className="mf-hint">{verified ? 'Each run starts from a snapshot and reverts to it afterwards, so you can run again with the same starting state.' : 'Verify both forks first.'}</span>
      </div>

      {results && (
        <section className="rf-results" aria-label="Results">
          <header>
            <p className="mono-label">
              Results · block {results.original.forkBlock.toLocaleString('en-US')} · {results.modified.modifications} change{results.modified.modifications === 1 ? '' : 's'} applied
            </p>
            <label className="rf-check">
              <input type="checkbox" checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} /> Only differences
            </label>
          </header>
          {shown.length === 0 ? (
            <p className="muted">No differences. Both forks produced the same receipts, traces and state changes.</p>
          ) : (
            <table className="gs-table rf-compare">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>What</th>
                  <th>Original</th>
                  <th>Modified</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row, index) => (
                  <tr key={index} className={row.differs ? 'is-diff' : undefined}>
                    <td>{row.call}</td>
                    <td>
                      <code title={row.aspect}>{aspectLabel(row.aspect)}</code>
                    </td>
                    <td>
                      <code title={row.original}>{cellValue(row.aspect, row.original)}</code>
                    </td>
                    <td>
                      <code title={row.modified}>{cellValue(row.aspect, row.modified)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="rf-pair">
            {(['original', 'modified'] as const).map((side) => (
              <div key={side} className="rf-trace">
                <p className="mono-label">{side === 'original' ? 'Original' : 'Modified'} · call trees</p>
                {results[side].outcomes.map((outcome) => (
                  <div key={outcome.txHash} className="rf-outcome">
                    <div className="rf-outcome-head">
                      <b>{outcome.label}</b>
                      <span className={`readiness-status ${outcome.status === 'success' ? '' : 'is-red'}`}>{outcome.status.toUpperCase()}</span>
                    </div>
                    <ol className="rf-frames">
                      {outcome.frames.map((frame, index) => (
                        <li key={index} style={{ paddingLeft: `${frame.depth * 14}px` }}>
                          <code>
                            {frame.type} {frame.to ? shortAddress(frame.to) : 'create'} · {frame.gasUsed.toLocaleString('en-US')} gas
                            {frame.value > 0n ? ` · ${formatEther(frame.value)} ETH` : ''}
                          </code>
                          {frame.error && <small className="field-error"> {frame.error}</small>}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="gs-fine">
        Reality Fork uses standard Anvil RPC (anvil_setCode, anvil_setStorageAt, anvil_setBalance, impersonation, evm_snapshot and debug_traceTransaction). Each transaction is mined at the fork block&apos;s timestamp plus 2 seconds per transaction and at its base fee, so both forks see identical block conditions. Hosted forks are not available: they need isolated compute that Quantum Fork does not run yet.
      </p>
    </div>
  )
}

function aspectLabel(aspect: string) {
  const [target, field] = aspect.split(' ')
  if (!field || !target.startsWith('0x')) return aspect
  return field.startsWith('storage:') ? `${shortAddress(target)} slot ${shortAddress(field.slice(8), 6, 4)}` : `${shortAddress(target)} ${field}`
}

function cellValue(aspect: string, value: string) {
  if (aspect.endsWith(' balance') && /^\d+$/.test(value)) return `${formatEther(BigInt(value))} ETH`
  if (/^0x[0-9a-f]{64}$/.test(value)) return `0x${value.slice(2).replace(/^0+(?=.)/, '')}`
  return value
}

function ModEditor({ mod, onChange, onRemove }: { mod: ModDraft; onChange: (mod: ModDraft) => void; onRemove: () => void }) {
  return (
    <div className="rf-item">
      <label className="mf-field">
        <span>Change</span>
        <select className="input" value={mod.kind} onChange={(event) => onChange({ ...mod, kind: event.target.value as ModDraft['kind'] })}>
          <option value="code">Replace contract code</option>
          <option value="storage">Set a storage slot</option>
          <option value="balance">Set an ETH balance</option>
        </select>
      </label>
      <label className="mf-field">
        <span>Address</span>
        <input className="input" value={mod.address} placeholder="0x…" spellCheck={false} onChange={(event) => onChange({ ...mod, address: event.target.value })} />
      </label>
      {mod.kind === 'code' && (
        <label className="mf-field rf-wide">
          <span>Runtime bytecode</span>
          <input className="input" value={mod.code} spellCheck={false} onChange={(event) => onChange({ ...mod, code: event.target.value })} />
        </label>
      )}
      {mod.kind === 'storage' && (
        <>
          <label className="mf-field">
            <span>Slot</span>
            <input className="input" value={mod.slot} spellCheck={false} onChange={(event) => onChange({ ...mod, slot: event.target.value })} />
          </label>
          <label className="mf-field">
            <span>Value (32 bytes)</span>
            <input className="input" value={mod.value} spellCheck={false} onChange={(event) => onChange({ ...mod, value: event.target.value })} />
          </label>
        </>
      )}
      {mod.kind === 'balance' && (
        <label className="mf-field">
          <span>Balance (ETH, fork only)</span>
          <input className="input" value={mod.eth} inputMode="decimal" onChange={(event) => onChange({ ...mod, eth: event.target.value })} />
        </label>
      )}
      <button type="button" className="icon-btn" aria-label="Remove this change" onClick={onRemove}>
        <Trash2 size={14} strokeWidth={1.8} />
      </button>
    </div>
  )
}

function CallEditor({ index, call, onChange, onRemove }: { index: number; call: CallDraft; onChange: (call: CallDraft) => void; onRemove?: () => void }) {
  const [signature, setSignature] = useState('')
  const [args, setArgs] = useState('[]')
  const [encodeError, setEncodeError] = useState<string | null>(null)

  function encode() {
    try {
      const item = parseAbiItem(`function ${signature.trim().replace(/^function\s+/, '')}`)
      if (item.type !== 'function') throw new Error('Not a function signature.')
      const values = JSON.parse(args) as unknown[]
      if (!Array.isArray(values)) throw new Error('Arguments must be a JSON array.')
      if (values.length !== item.inputs.length) throw new Error(`Expected ${item.inputs.length} argument${item.inputs.length === 1 ? '' : 's'}, got ${values.length}.`)
      const coerced = values.map((value, at) => (/^u?int\d*$/.test(item.inputs[at].type) && (typeof value === 'string' || typeof value === 'number') ? BigInt(value) : value))
      onChange({ ...call, data: encodeFunctionData({ abi: [item], functionName: item.name, args: coerced }) })
      setEncodeError(null)
    } catch (cause) {
      setEncodeError(cause instanceof Error ? cause.message.split('\n')[0] : 'Could not encode.')
    }
  }

  return (
    <div className="rf-item rf-call">
      <label className="mf-field">
        <span>Label</span>
        <input className="input" value={call.label} placeholder={`Transaction ${index + 1}`} maxLength={48} onChange={(event) => onChange({ ...call, label: event.target.value })} />
      </label>
      <label className="mf-field">
        <span>From (impersonated)</span>
        <input className="input" value={call.from} spellCheck={false} onChange={(event) => onChange({ ...call, from: event.target.value })} />
      </label>
      <label className="mf-field">
        <span>To</span>
        <input className="input" value={call.to} placeholder="0x…" spellCheck={false} onChange={(event) => onChange({ ...call, to: event.target.value })} />
      </label>
      <label className="mf-field">
        <span>Value (ETH)</span>
        <input className="input" value={call.eth} inputMode="decimal" onChange={(event) => onChange({ ...call, eth: event.target.value })} />
      </label>
      <label className="mf-field">
        <span>Gas limit</span>
        <input className="input" value={call.gas} inputMode="numeric" onChange={(event) => onChange({ ...call, gas: event.target.value.replace(/\D/g, '') })} />
      </label>
      <label className="mf-field rf-wide">
        <span>Calldata</span>
        <input className="input" value={call.data} spellCheck={false} onChange={(event) => onChange({ ...call, data: event.target.value })} />
      </label>
      <div className="rf-encode rf-wide">
        <input className="input" value={signature} placeholder="transfer(address to, uint256 amount)" spellCheck={false} aria-label="Function signature" onChange={(event) => setSignature(event.target.value)} />
        <input className="input" value={args} placeholder='["0x…", "1000"]' spellCheck={false} aria-label="Arguments as a JSON array" onChange={(event) => setArgs(event.target.value)} />
        <button type="button" className="btn btn-quiet btn-sm" disabled={!signature.trim()} onClick={encode}>
          Encode
        </button>
        {encodeError && <small className="field-error">{encodeError}</small>}
      </div>
      {onRemove && (
        <button type="button" className="icon-btn" aria-label="Remove this transaction" onClick={onRemove}>
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      )}
    </div>
  )
}
