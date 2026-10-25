import { Copy, Play, Search } from 'lucide-react'
import { useState } from 'react'
import { formatEther, type Hex, parseEther } from 'viem'
import { forkMetadata, forkRpc, ForkRpcError } from '../lib/evm/forkRpc'
import { loadHistory, type LoadedHistory } from '../lib/evm/history'
import { usePageMeta } from '../lib/meta'
import { copyText, toast } from '../lib/toast'
import { useLocation } from '../navigation'
import { shortAddress } from '../protocol/address'
import { BASE_EXPLORER, type BaseNetwork } from '../protocol/base'
import { checkForkIdentity, compareRuns, type Rpc } from '../protocol/realityFork'
import { compareToChain, type FidelityRow, replayHistory, type ReplayReport, TIME_MACHINE_PORT, timeMachineCommand } from '../protocol/timeMachine'
import { Link } from '../router'

const NETWORK: Record<BaseNetwork, string> = { base: 'Base', 'base-sepolia': 'Base Sepolia' }

function Execution({ outcome, step, onStep, title = 'Execution' }: { outcome: ReplayReport['faithful']['outcome']; step: number; onStep: (index: number) => void; title?: string }) {
  const frame = outcome.frames[Math.min(step, Math.max(0, outcome.frames.length - 1))]
  return (
    <div className="tm-exec">
      <p className="mono-label">{title} · {outcome.status} · {outcome.gasUsed.toLocaleString('en-US')} gas · {outcome.frames.length} steps · {outcome.logs.length} events</p>
      <ol className="tm-steps">
        {outcome.frames.map((item, index) => (
          <li key={index}>
            <button type="button" className={index === step ? 'is-on' : undefined} onClick={() => onStep(index)}>
              <code>{item.type} {item.to ? shortAddress(item.to) : 'create'} · {item.gasUsed.toLocaleString('en-US')} gas</code>
            </button>
          </li>
        ))}
      </ol>
      {frame && <p className="mf-hint">{frame.error ? `Reverted: ${frame.error}` : 'This step returned without an error.'} Depth {frame.depth}. {outcome.changes.length.toLocaleString('en-US')} state changes on the transaction.</p>}
    </div>
  )
}

export default function TimeMachine() {
  usePageMeta({ title: 'Time Machine', description: 'Replay a Base transaction on a local Anvil fork of its parent block, after the transactions ahead of it in the same block, and compare a modified run.', path: '/lab/time-machine' })
  const { query } = useLocation()
  const [source, setSource] = useState<BaseNetwork>(query.get('source') === 'base' ? 'base' : 'base-sepolia')
  const [hash, setHash] = useState(query.get('tx') ?? '')
  const [history, setHistory] = useState<LoadedHistory | null>(null)
  const [url, setUrl] = useState(`http://127.0.0.1:${TIME_MACHINE_PORT}`)
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ReplayReport | null>(null)
  const [fidelity, setFidelity] = useState<FidelityRow[] | null>(null)
  const [data, setData] = useState('')
  const [value, setValue] = useState('')
  const [gas, setGas] = useState('')
  const [step, setStep] = useState(0)

  const command = history ? timeMachineCommand(history.source, history.parentBlock) : null

  async function load() {
    setBusy('load')
    setError(null)
    setReport(null)
    setFidelity(null)
    setVerified(false)
    try {
      const loaded = await loadHistory(source, hash.trim())
      setHistory(loaded)
      setData(loaded.input)
      setValue(formatEther(loaded.value))
      setGas(String(loaded.gas))
      setStep(0)
    } catch (cause) {
      setHistory(null)
      setError(cause instanceof Error ? cause.message : 'Could not read that transaction.')
    } finally {
      setBusy(null)
    }
  }

  async function check() {
    if (!history) return
    setBusy('check')
    setError(null)
    setVerified(false)
    setReport(null)
    try {
      const metadata = await forkMetadata(forkRpc(url))
      const issues = checkForkIdentity(metadata, { source: history.source, block: history.parentBlock, blockHash: history.parentHash })
      if (issues.length) throw new Error(issues[0].message)
      setVerified(true)
    } catch (cause) {
      setError(cause instanceof ForkRpcError || cause instanceof Error ? cause.message : 'The fork could not be checked.')
    } finally {
      setBusy(null)
    }
  }

  async function run(edit: boolean) {
    if (!history || !verified) return
    setBusy(edit ? 'edit' : 'replay')
    setError(null)
    try {
      let valueWei = history.value
      if (edit) {
        try {
          valueWei = parseEther(value.trim() || '0')
        } catch {
          throw new Error('Value has to be a number of ETH, such as 0 or 0.1.')
        }
      }
      const gasLimit = edit ? Number(gas) : undefined
      if (edit && (!Number.isInteger(gasLimit) || gasLimit! < 21_000)) throw new Error('Gas limit has to be a whole number of at least 21000.')
      const rpc: Rpc = forkRpc(url)
      const result = await replayHistory(rpc, history.items, { timestamp: BigInt(history.timestamp), baseFee: history.baseFee }, history.blockNumber, edit ? { data: data.trim() as Hex, value: valueWei, gas: BigInt(gasLimit!), state: [] } : undefined)
      setReport(result)
      setFidelity(compareToChain({ status: history.status, gasUsed: history.gasUsed, logs: history.logs }, result.faithful.outcome, result.faithful.blockNumber, history.blockNumber).rows)
      setStep(0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Replay failed.')
    } finally {
      setBusy(null)
    }
  }

  const matched = fidelity?.every((row) => row.aspect === 'Block number' || !row.differs) ?? false
  const rows = report?.modified ? compareRuns({ forkBlock: history?.parentBlock ?? 0, modifications: 0, outcomes: [report.faithful.outcome] }, { forkBlock: history?.parentBlock ?? 0, modifications: 1, outcomes: [report.modified.outcome] }) : []

  return (
    <div className="gs tm">
      <header className="gs-head">
        <div>
          <p className="eyebrow">
            <Link to="/lab">Lab</Link> · Time Machine · runs locally
          </p>
          <h1>Replay the block, not the guess.</h1>
          <p className="section-lede">Load a Base transaction, fork the block before it, and resubmit every transaction ahead of it in that block before replaying it. The result is checked against the receipt Base already has.</p>
        </div>
      </header>
      <p className="callout tm-banner">
        <b>FORK, NOT BASE.</b> Reading the transaction uses the public endpoint. Replaying it happens on Anvil on your machine. Nothing is sent back to {NETWORK[source]}.
      </p>

      <section className="gs-panel">
        <p className="mono-label">1 · Transaction</p>
        <div className="rf-row">
          <label className="mf-field">
            <span>Network</span>
            <select className="input" value={source} onChange={(event) => { setSource(event.target.value as BaseNetwork); setVerified(false); setReport(null) }}>
              <option value="base-sepolia">Base Sepolia</option>
              <option value="base">Base</option>
            </select>
          </label>
          <label className="mf-field tm-hash">
            <span>Transaction hash</span>
            <input className="input" value={hash} spellCheck={false} placeholder="0x…" onChange={(event) => setHash(event.target.value)} />
          </label>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy === 'load'} onClick={() => void load()}>
            <Search size={14} strokeWidth={1.8} /> {busy === 'load' ? 'Reading…' : 'Load from Base'}
          </button>
        </div>
      </section>

      {history && (
        <>
          <section className="gs-panel">
            <p className="mono-label">2 · What Base recorded</p>
            <ol className="tm-rail">
              {history.items.map((item, index) => (
                <li key={item.hash} className={index === history.index ? 'is-target' : undefined}>
                  <span>{index === history.index ? 'Target' : `Before · ${index + 1}`}</span>
                  <b>{item.kind === 'deposit' ? 'Deposit' : 'Transaction'}</b>
                  <code>{shortAddress(item.hash, 8, 6)}</code>
                  <small>{item.to ? shortAddress(item.to) : 'create'}</small>
                </li>
              ))}
            </ol>
            <dl className="gs-hashes">
              <div><dt>Block</dt><dd><a href={`${BASE_EXPLORER[history.source]}/tx/${history.hash}`} target="_blank" rel="noreferrer">{history.blockNumber.toLocaleString('en-US')}</a> · index {history.index} · {history.status}</dd></div>
              <div><dt>From</dt><dd><code>{history.from}</code></dd></div>
              <div><dt>Gas used</dt><dd>{history.gasUsed.toLocaleString('en-US')}</dd></div>
              <div><dt>Value</dt><dd>{formatEther(history.value)} ETH</dd></div>
            </dl>
            {history.transfers.length > 0 && (
              <ul className="gs-infra">
                {history.transfers.map((transfer, index) => (
                  <li key={index}><span>{transfer.kind === 'erc20' ? 'ERC-20' : 'ERC-721'} · {shortAddress(transfer.token)}</span><small>{shortAddress(transfer.from)} → {shortAddress(transfer.to)} · {transfer.amount}</small></li>
                ))}
              </ul>
            )}
            <p className="mf-hint">Fork block {history.parentBlock.toLocaleString('en-US')}, the parent. Forking {history.blockNumber.toLocaleString('en-US')} itself would be the state after every transaction in the block, including this one.</p>
          </section>

          <section className="gs-panel">
            <p className="mono-label">3 · Fork and replay</p>
            {command && (
              <div className="rf-command">
                <span className="mono-label">Anvil</span>
                <pre className="gs-command">{command}</pre>
                <button type="button" className="icon-btn" aria-label="Copy the Anvil command" onClick={() => void copyText(command).then(() => toast('Command copied.'))}><Copy size={14} strokeWidth={1.8} /></button>
              </div>
            )}
            <div className="rf-row">
              <label className="mf-field tm-hash">
                <span>Fork URL</span>
                <input className="input" value={url} onChange={(event) => { setUrl(event.target.value); setVerified(false) }} />
              </label>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy === 'check'} onClick={() => void check()}>{verified ? 'Fork matches the parent block' : 'Check fork'}</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={!verified || busy === 'replay'} onClick={() => void run(false)}><Play size={14} strokeWidth={1.8} /> {busy === 'replay' ? 'Replaying…' : 'Replay'}</button>
            </div>
          </section>

          {fidelity && report && (
            <section className="gs-panel">
              <p className="mono-label">{matched ? 'Replay matches the Base receipt' : 'Replay diverged from the Base receipt'}</p>
              <table className="gs-table">
                <thead><tr><th>What</th><th>{NETWORK[history.source]}</th><th>Replay</th></tr></thead>
                <tbody>
                  {fidelity.map((row) => (
                    <tr key={row.aspect} className={row.differs ? 'is-diff' : undefined}><td>{row.aspect}</td><td><code>{row.chain}</code></td><td><code>{row.replay}</code></td></tr>
                  ))}
                </tbody>
              </table>
              {!report.historicalBlock && <p className="mf-hint">The replay mined this transaction in a later block. A contract that reads the block number can take a different path. The table is the comparison, not an assumption.</p>}
              <Execution outcome={report.faithful.outcome} step={step} onStep={setStep} />
            </section>
          )}

          {matched && report && (
            <section className="gs-panel">
              <p className="mono-label">4 · Change the transaction and run it again</p>
              <div className="rf-row">
                <label className="mf-field tm-hash"><span>Calldata</span><input className="input" value={data} spellCheck={false} onChange={(event) => setData(event.target.value)} /></label>
                <label className="mf-field"><span>Value (ETH)</span><input className="input" value={value} onChange={(event) => setValue(event.target.value)} /></label>
                <label className="mf-field"><span>Gas limit</span><input className="input" value={gas} inputMode="numeric" onChange={(event) => setGas(event.target.value.replace(/\D/g, ''))} /></label>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'edit'} onClick={() => void run(true)}>{busy === 'edit' ? 'Running…' : 'Run the edit'}</button>
              </div>
              <p className="mf-hint">The edit is sent from the same address, with the same nonce, after the same preceding transactions. No wallet signs it. The fork is reverted afterwards.</p>
            </section>
          )}

          {report?.modified && (
            <section className="rf-results">
              <p className="mono-label">Historical replay against the edit</p>
              <table className="gs-table rf-compare">
                <thead><tr><th>What</th><th>Historical</th><th>Edited</th></tr></thead>
                <tbody>
                  {rows.filter((row) => row.differs).map((row, index) => (
                    <tr key={index} className="is-diff"><td><code>{row.aspect}</code></td><td><code>{row.original}</code></td><td><code>{row.modified}</code></td></tr>
                  ))}
                </tbody>
              </table>
              {rows.every((row) => !row.differs) && <p className="muted">The edit produced the same status, gas, events and state changes.</p>}
              <div className="rf-pair">
                <Execution outcome={report.faithful.outcome} step={step} onStep={setStep} title="Historical" />
                {report.modified && <Execution outcome={report.modified.outcome} step={step} onStep={setStep} title="Edited" />}
              </div>
            </section>
          )}
        </>
      )}
      {error && <p className="callout is-warn">{error}</p>}
      <p className="gs-fine">A fork of the parent block is the state before the block, not the state before your transaction. Time Machine resubmits the earlier transactions, including Base deposit transactions, and then compares status, gas and logs with the real receipt. A difference is shown as a difference.</p>
    </div>
  )
}
