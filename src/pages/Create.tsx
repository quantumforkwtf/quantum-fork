import { Anchor, Copy, Download, FileUp, GitCompare, Save, Share2, Trash2, Upload } from 'lucide-react'
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Architecture } from '../components/dna/Architecture'
import { Genome } from '../components/dna/Genome'
import { BaseWalletPanel } from '../components/BaseWallet'
import FailurePanel from '../components/FailurePanel'
import { explorerTx, useServerStatus } from '../config'
import { api } from '../lib/api'
import { duplicateDna, removeDna, saveDna, useDnaLibrary } from '../lib/dnaLibrary'
import { type AnchorRecord, type AnchorReview, prepareAnchor, publishDna, type PublishedConfig, sendAnchor, verifyAnchorTx } from '../lib/evm/anchor'
import { useEvmWallet } from '../lib/evm/wallet'
import { FlowError } from '../lib/failures'
import { usePageMeta } from '../lib/meta'
import { copyText, toast } from '../lib/toast'
import { useLocation } from '../navigation'
import { shortAddress } from '../protocol/address'
import type { BaseNetwork } from '../protocol/base'
import {
  anvilCommand,
  CATEGORIES,
  type Category,
  type ChainDna,
  chosenOptions,
  canonicalJson,
  decodeShare,
  defaultDna,
  diffDna,
  dnaHash,
  encodeShare,
  FIELDS,
  type FieldMeta,
  getPath,
  infrastructure,
  LAYERS,
  normalizeDna,
  parseDna,
  readiness,
  REGISTRY_KIND,
  type ReadinessItem,
  retarget,
  SUPPORT,
  TARGET_IDS,
  TARGETS,
  technicalHash,
  validateDna,
} from '../protocol/chainDna'
import { REGISTRY_MAX_URI_BYTES } from '../protocol/registry'
import { Link } from '../router'

const CATEGORY_LABEL: Record<Category, string> = { network: 'Network', economics: 'Economics', execution: 'Execution', security: 'Security', privacy: 'Privacy', cryptography: 'Cryptography' }
const STATUS_LABEL: Record<ReadinessItem['status'], string> = { ready: 'READY', planned: 'PLANNED', blocked: 'BLOCKED', research: 'RESEARCH' }

function initialDna(): { dna: ChainDna; note: string | null } {
  const match = window.location.hash.match(/^#dna=([A-Za-z0-9_-]+)$/)
  if (!match) return { dna: defaultDna('base'), note: null }
  const decoded = decodeShare(match[1])
  if (!decoded.ok) return { dna: defaultDna('base'), note: `The shared configuration could not be read: ${decoded.issues[0]}` }
  return { dna: normalizeDna(decoded.dna), note: canonicalJson(normalizeDna(decoded.dna)) === canonicalJson(decoded.dna) ? null : 'Opened a shared configuration. Values its target fixes were reset.' }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chain'

export default function Create() {
  usePageMeta({ title: 'Genesis Studio', description: 'Design a blockchain environment as Chain DNA: contracts on Base, a local Anvil devnet, or a dedicated OP Stack rollup. Every option says what the target can really do.', path: '/create' })
  const status = useServerStatus()
  const evm = useEvmWallet()
  const library = useDnaLibrary()
  const { query } = useLocation()
  const [{ dna, note }, setState] = useState(initialDna)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [category, setCategory] = useState<Category>('network')
  const [compareId, setCompareId] = useState<string | null>(null)
  const [published, setPublished] = useState<PublishedConfig | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<FlowError | null>(null)
  const [review, setReview] = useState<AnchorReview | null>(null)
  const [anchor, setAnchor] = useState<AnchorRecord | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const setDna = (next: ChainDna, message: string | null = null) => setState({ dna: next, note: message })
  const update = (change: (draft: ChainDna) => void) => {
    const next = structuredClone(dna)
    change(next)
    setDna(normalizeDna(next))
  }

  const fromServer = query.get('config')
  useEffect(() => {
    if (!fromServer || !/^0x[0-9a-f]{64}$/.test(fromServer)) return
    api<{ config: PublishedConfig }>(`/api/configs?hash=${fromServer}`)
      .then(({ data }) => {
        const parsed = parseDna(data.config.dna)
        if (parsed.ok) setState({ dna: parsed.dna, note: `Opened published configuration ${fromServer.slice(0, 10)}…` })
      })
      .catch(() => setState((current) => ({ ...current, note: 'That published configuration could not be loaded.' })))
  }, [fromServer])

  const hash = useMemo(() => dnaHash(dna), [dna])
  const genomeId = useMemo(() => technicalHash(dna), [dna])
  const issues = useMemo(() => validateDna(dna), [dna])
  const errors = issues.filter((issue) => issue.level === 'error')
  const items = useMemo(() => readiness(dna), [dna])
  const compared = library.find((item) => item.id === compareId)
  const differences = useMemo(() => (compared ? diffDna(compared.dna, dna) : []), [compared, dna])

  useEffect(() => {
    if (published && published.hash !== hash) setPublished(null)
    if (anchor && anchor.configHash !== hash) setAnchor(null)
    setReview(null)
    // Only the configuration hash invalidates publication and anchoring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash])

  const storage = status.state === 'ok' ? status.status.storage.persistent : false
  const base = status.state === 'ok' ? status.status.base : undefined
  const registry = base?.registry ?? null
  const metadataURI = `${window.location.origin}/api/configs?hash=${hash}`

  const runtime: ReadinessItem[] = [
    { id: 'publish', label: 'Publish to the explorer', status: errors.length ? 'blocked' : storage ? 'ready' : 'blocked', detail: storage ? 'Stores this document under its hash for anyone to open.' : 'This server has no durable storage configured.' },
    {
      id: 'anchor',
      label: `Anchor the hash on ${base?.network === 'base' ? 'Base' : 'Base Sepolia'}`,
      status: errors.length ? 'blocked' : registry ? 'ready' : 'planned',
      detail: registry ? 'Your wallet writes the hash to QForkRegistry; the server reads it back at a finalized block.' : 'QForkRegistry is written and tested but not deployed on this network yet.',
    },
  ]

  const save = () => {
    const entry = saveDna(dna, savedId ?? undefined)
    setSavedId(entry.id)
    toast('Saved in this browser.')
  }

  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 64 * 1024) return setDna(dna, 'That file is too large to be Chain DNA.')
    const parsed = parseDna(await file.text())
    if (!parsed.ok) return setDna(dna, `Import failed. ${parsed.issues.join(' · ')}`)
    const normalized = normalizeDna(parsed.dna)
    setSavedId(null)
    setDna(normalized, canonicalJson(normalized) === canonicalJson(parsed.dna) ? `Imported ${file.name}.` : `Imported ${file.name}. Values its target fixes were reset.`)
  }

  const share = () => {
    const url = `${window.location.origin}/create#dna=${encodeShare(dna)}`
    void copyText(url).then(() => toast('Share link copied. The configuration travels in the link; nothing is uploaded.'))
  }

  const publish = async () => {
    setError(null)
    setBusy('Publishing…')
    try {
      setPublished(await publishDna(dna))
      toast('Published.')
    } catch (caught) {
      setError(caught instanceof FlowError ? caught : new FlowError('API_UNAVAILABLE'))
    } finally {
      setBusy(null)
    }
  }

  const reviewAnchor = async () => {
    if (!registry || !base || !evm.address) return
    setError(null)
    setBusy('Dry-running the registry call…')
    try {
      if (new TextEncoder().encode(metadataURI).length > REGISTRY_MAX_URI_BYTES) throw new FlowError('ANCHOR_FAILED', 'The metadata URI is too long for the registry.')
      setReview(await prepareAnchor({ owner: evm.address, registry: registry as `0x${string}`, network: base.network as BaseNetwork, chainId: base.chainId, hash, kind: REGISTRY_KIND[dna.target], uri: metadataURI }))
    } catch (caught) {
      setError(caught instanceof FlowError ? caught : new FlowError('ANCHOR_FAILED'))
    } finally {
      setBusy(null)
    }
  }

  const signAnchor = async () => {
    if (!review) return
    setError(null)
    setBusy('Approve the transaction in your wallet…')
    let sent: `0x${string}` | null = null
    try {
      sent = await sendAnchor(review)
      setTxHash(sent)
      setReview(null)
      setBusy('Sent. The server records it once Base finalizes the block, usually 15 to 20 minutes.')
      setAnchor(await verifyAnchorTx(hash, sent))
    } catch (caught) {
      setError(caught instanceof FlowError ? caught : new FlowError('ANCHOR_NOT_RECORDED', undefined, sent ? { signature: sent } : {}))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="gs">
      <header className="gs-head">
        <div>
          <p className="eyebrow">Genesis Studio · Chain DNA v1</p>
          <h1>Fork reality. Design the chain.</h1>
          <p className="section-lede">
            One configuration, three honest targets. Every option says whether the target provides it, needs your contracts, needs dedicated infrastructure, or is research only. Nothing on this page deploys a chain.
          </p>
        </div>
        <div className="gs-actions">
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void onImport(event)} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={save}>
            <Save size={14} strokeWidth={1.8} /> {savedId ? 'Save' : 'Save as new'}
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => fileInput.current?.click()}>
            <FileUp size={14} strokeWidth={1.8} /> Import
          </button>
          <button type="button" className="btn btn-quiet btn-sm" disabled={errors.length > 0} onClick={() => download(`${slug(dna.name)}.chain-dna.json`, `${JSON.stringify(dna, null, 2)}\n`)}>
            <Download size={14} strokeWidth={1.8} /> Export
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={share}>
            <Share2 size={14} strokeWidth={1.8} /> Share link
          </button>
        </div>
      </header>

      {note && <p className="callout gs-note">{note}</p>}

      <div className="gs-targets" role="radiogroup" aria-label="Target">
        {TARGET_IDS.map((target) => (
          <button key={target} type="button" role="radio" aria-checked={dna.target === target} className={`gs-target ${dna.target === target ? 'is-on' : ''}`} onClick={() => dna.target !== target && setDna(retarget(dna, target))}>
            <span className="mono-label">{TARGETS[target].short}</span>
            <b>{TARGETS[target].label}</b>
            <span>{TARGETS[target].summary}</span>
            <small className={TARGETS[target].independent ? 'is-independent' : ''}>{TARGETS[target].independent ? 'Independent chain' : 'Not an independent chain'}</small>
          </button>
        ))}
      </div>

      <div className="gs-grid">
        <section className="gs-config" aria-label="Configuration">
          <nav className="gs-tabs" aria-label="Categories">
            {CATEGORIES.map((item) => {
              const count = issues.filter((issue) => issue.level === 'error' && (FIELDS.find((field) => field.path === issue.path)?.category ?? issue.path.split('.')[0]) === item).length
              return (
                <button key={item} type="button" className={category === item ? 'is-on' : ''} aria-current={category === item ? 'true' : undefined} onClick={() => setCategory(item)}>
                  {CATEGORY_LABEL[item]}
                  {count > 0 && <i className="gs-tab-badge">{count}</i>}
                </button>
              )
            })}
          </nav>

          {category === 'network' && <Identity dna={dna} update={update} />}
          {category === 'network' && <NetworkNumbers dna={dna} update={update} />}
          {category === 'economics' && <EconomicsNumbers dna={dna} update={update} />}
          {FIELDS.filter((field) => field.category === category && !(field.path === 'network.settlement' && dna.target === 'local-devnet')).map((field) => (
            <FieldControl key={field.path} field={field} dna={dna} update={update} />
          ))}
          <FieldIssues issues={issues.filter((issue) => (FIELDS.find((field) => field.path === issue.path)?.category ?? issue.path.split('.')[0]) === category)} />
        </section>

        <aside className="gs-side" aria-label="Genome and readiness">
          <div className="gs-genome">
            <Genome dna={dna} size={220} />
            <dl className="gs-hashes">
              <div>
                <dt>Document hash</dt>
                <dd>
                  <code title={hash}>{shortAddress(hash, 10, 8)}</code>
                </dd>
              </div>
              <div>
                <dt>Genome</dt>
                <dd>
                  <code title={genomeId}>{shortAddress(genomeId, 10, 8)}</code>
                </dd>
              </div>
            </dl>
            <ul className="gs-legend">
              {(['native', 'contracts', 'infrastructure', 'research'] as const).map((level) => (
                <li key={level} className={`is-${level}`}>
                  {SUPPORT[level].label}
                </li>
              ))}
            </ul>
          </div>

          <div className="gs-panel">
            <p className="mono-label">Deployment readiness</p>
            <ul className="readiness">
              {[...items, ...runtime].map((item) => (
                <li key={item.id} className={`is-${item.status}`}>
                  <span className="readiness-status">{STATUS_LABEL[item.status]}</span>
                  <div>
                    <b>{item.label}</b>
                    <small>{item.detail}</small>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="gs-panel">
            <p className="mono-label">Architecture</p>
            <Architecture dna={dna} />
          </div>

          <div className="gs-panel">
            <p className="mono-label">Who runs what</p>
            <ul className="gs-infra">
              {infrastructure(dna).map((item) => (
                <li key={item.component}>
                  <span>{item.component}</span>
                  <small>{item.operator}</small>
                </li>
              ))}
            </ul>
          </div>

          {dna.target === 'local-devnet' && (
            <div className="gs-panel">
              <p className="mono-label">Run it</p>
              <pre className="gs-command">{anvilCommand(dna)}</pre>
              <button type="button" className="btn btn-quiet btn-sm" disabled={errors.length > 0} onClick={() => void copyText(anvilCommand(dna)).then(() => toast('Command copied.'))}>
                <Copy size={14} strokeWidth={1.8} /> Copy command
              </button>
              {dna.network.fork && (
                <Link to={`/lab/reality-fork?source=${dna.network.fork.source}${dna.network.fork.block ? `&block=${dna.network.fork.block}` : ''}`} className="btn btn-quiet btn-sm">
                  Compare against a modified fork →
                </Link>
              )}
              <small className="muted">Needs Foundry. Funded accounts are Anvil’s public development keys: never send real funds to them.</small>
            </div>
          )}

          <div className="gs-panel">
            <p className="mono-label">Publish and anchor</p>
            <div className="gs-row">
              <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy) || errors.length > 0 || !storage} onClick={() => void publish()}>
                <Upload size={14} strokeWidth={1.8} /> {published ? 'Published' : 'Publish'}
              </button>
              {published && <Link to={`/explore/${published.hash}`}>Open in explorer →</Link>}
            </div>
            {published && registry && !anchor && (
              <>
                <BaseWalletPanel />
                {evm.address && !review && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void reviewAnchor()}>
                    <Anchor size={14} strokeWidth={1.8} /> Review anchor transaction
                  </button>
                )}
              </>
            )}
            {review && (
              <div className="gs-review">
                <dl className="report">
                  <div>
                    <dt>Contract</dt>
                    <dd>
                      <code>{review.registry}</code> · QForkRegistry
                    </dd>
                  </div>
                  <div>
                    <dt>Call</dt>
                    <dd>
                      register(<code>{shortAddress(hash, 8, 6)}</code>, {REGISTRY_KIND[dna.target]}, metadata URI)
                    </dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd>{review.network === 'base' ? 'Base mainnet · real ETH' : 'Base Sepolia · test ETH, no value'}</dd>
                  </div>
                  <div>
                    <dt>Value sent</dt>
                    <dd>0 ETH</dd>
                  </div>
                  <div>
                    <dt>Gas</dt>
                    <dd>about {(Number(review.feeWei) / 1e18).toFixed(8)} ETH</dd>
                  </div>
                </dl>
                <p className="muted">Records your address as creator of this hash, permanently and publicly. It registers a configuration; it does not deploy a chain.</p>
                <div className="gs-row">
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setReview(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => void signAnchor()}>
                    Sign and anchor
                  </button>
                </div>
              </div>
            )}
            {busy && <p className="muted">{busy}</p>}
            {txHash && base && (
              <p className="muted">
                Transaction{' '}
                <a href={explorerTx(txHash, base.network)} target="_blank" rel="noreferrer">
                  {shortAddress(txHash, 8, 8)}
                </a>
              </p>
            )}
            {anchor && (
              <p className="callout">
                Anchored by <code>{shortAddress(anchor.creator)}</code> at block {anchor.blockNumber.toLocaleString('en-US')}, verified by the server.
              </p>
            )}
            {error && <FailurePanel error={error} />}
          </div>
        </aside>
      </div>

      <section className="gs-library" aria-label="Saved configurations">
        <header>
          <p className="mono-label">Saved in this browser · {library.length}</p>
          {compared && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setCompareId(null)}>
              Close comparison
            </button>
          )}
        </header>
        {library.length === 0 ? (
          <p className="muted">Nothing saved yet. Saved configurations stay on this device until you export or publish them.</p>
        ) : (
          <ul className="library">
            {library.map((entry) => (
              <li key={entry.id} className={entry.id === savedId ? 'is-open' : ''}>
                <Genome dna={entry.dna} size={44} />
                <div>
                  <b>{entry.dna.name}</b>
                  <small>
                    {TARGETS[entry.dna.target].short} · {new Date(entry.savedAt).toLocaleString()}
                  </small>
                </div>
                <div className="library-actions">
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => {
                      setSavedId(entry.id)
                      setDna(entry.dna, `Opened ${entry.dna.name}.`)
                    }}
                  >
                    Open
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Compare with ${entry.dna.name}`} title="Compare with the current configuration" onClick={() => setCompareId(entry.id)}>
                    <GitCompare size={14} strokeWidth={1.8} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Duplicate ${entry.dna.name}`} title="Duplicate" onClick={() => duplicateDna(entry.id) && toast('Duplicated.')}>
                    <Copy size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete ${entry.dna.name}`}
                    title="Delete"
                    onClick={() => {
                      removeDna(entry.id)
                      if (entry.id === savedId) setSavedId(null)
                    }}
                  >
                    <Trash2 size={14} strokeWidth={1.8} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {compared && (
          <div className="gs-compare">
            <p className="mono-label">
              {compared.dna.name} → current · {differences.length} difference{differences.length === 1 ? '' : 's'}
            </p>
            {differences.length === 0 ? (
              <p className="muted">Identical configurations: same hash, same genome.</p>
            ) : (
              <table className="gs-table">
                <thead>
                  <tr>
                    <th>Setting</th>
                    <th>Layer</th>
                    <th>{compared.dna.name}</th>
                    <th>Current</th>
                  </tr>
                </thead>
                <tbody>
                  {differences.map((row) => (
                    <tr key={row.path}>
                      <td>{row.label}</td>
                      <td>{FIELDS.find((field) => field.path === row.path) ? LAYERS[FIELDS.find((field) => field.path === row.path)!.layer] : '—'}</td>
                      <td>
                        <code>{row.left}</code>
                      </td>
                      <td>
                        <code>{row.right}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      <p className="gs-fine">
        {chosenOptions(dna).length} choices · Chain DNA is a design document. Post-quantum options are research and are not production-secure. Base itself does not become quantum-resistant through anything configured here.
      </p>
    </div>
  )
}

type Update = (change: (draft: ChainDna) => void) => void

function FieldControl({ field, dna, update }: { field: FieldMeta; dna: ChainDna; update: Update }) {
  const value = getPath(dna, field.path)
  const selected = new Set(field.multi ? (value as string[]) : [value as string])
  const locked = dna.target === 'base' && (field.path === 'execution.evm' || field.path === 'execution.precompiles' || field.path === 'security.sequencing')
  const set = (option: string) =>
    update((draft) => {
      const [group, key] = field.path.split('.') as [keyof ChainDna, string]
      const target = draft[group] as unknown as Record<string, unknown>
      if (field.multi) {
        const current = new Set(target[key] as string[])
        if (current.has(option)) current.delete(option)
        else current.add(option)
        target[key] = [...current]
      } else target[key] = option
    })
  return (
    <fieldset className="dna-field">
      <legend>
        {field.label} <span className="dna-layer">{LAYERS[field.layer]}</span>
        {locked && <span className="dna-locked">Set by Base</span>}
      </legend>
      <div className="dna-options">
        {Object.entries(field.options).map(([id, option]) => {
          const support = option.support[dna.target]
          const on = selected.has(id)
          const disabled = locked || (support === 'unsupported' && !on)
          return (
            <button key={id} type="button" aria-pressed={on} disabled={disabled} className={`dna-option ${on ? 'is-on' : ''} is-${support}`} onClick={() => set(id)}>
              <span className="dna-option-head">
                <b>{option.label}</b>
                <i>{SUPPORT[support].label}</i>
              </span>
              <span>{option.detail}</span>
              {option.notes?.[dna.target] && <small>{option.notes[dna.target]}</small>}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function Identity({ dna, update }: { dna: ChainDna; update: Update }) {
  return (
    <div className="dna-numbers">
      <label className="mf-field" htmlFor="dna-name">
        <span className="mono-label">Name</span>
        <input id="dna-name" className="input" value={dna.name} maxLength={40} onChange={(event) => update((draft) => void (draft.name = event.target.value))} />
      </label>
      <label className="mf-field" htmlFor="dna-description">
        <span className="mono-label">Description</span>
        <input id="dna-description" className="input" value={dna.description} maxLength={280} onChange={(event) => update((draft) => void (draft.description = event.target.value))} />
      </label>
    </div>
  )
}

function NumberInput({ id, label, value, locked, min, max, step = 1, onChange, hint }: { id: string; label: string; value: number | null; locked?: string; min: number; max: number; step?: number; onChange: (value: number) => void; hint?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value))
  useEffect(() => setText(value === null ? '' : String(value)), [value])
  return (
    <label className="mf-field" htmlFor={id}>
      <span className="mono-label">{label}</span>
      <input
        id={id}
        className="input"
        inputMode="decimal"
        value={locked ?? text}
        disabled={Boolean(locked)}
        onChange={(event) => {
          setText(event.target.value)
          const next = Number(event.target.value)
          if (event.target.value.trim() !== '' && Number.isFinite(next) && next >= min && next <= max) onChange(step === 1 ? Math.round(next) : next)
        }}
      />
      {hint && <small className="mf-hint">{hint}</small>}
    </label>
  )
}

function NetworkNumbers({ dna, update }: { dna: ChainDna; update: Update }) {
  const base = dna.target === 'base'
  return (
    <div className="dna-numbers">
      <NumberInput id="dna-chain" label="Chain ID" value={dna.network.chainId} locked={base ? String(dna.network.chainId) : undefined} min={1} max={4_294_967_295} onChange={(value) => update((draft) => void (draft.network.chainId = value))} />
      <label className="mf-field" htmlFor="dna-block">
        <span className="mono-label">Block time</span>
        <select id="dna-block" className="input" value={dna.network.blockTimeMs} disabled={base} onChange={(event) => update((draft) => void (draft.network.blockTimeMs = Number(event.target.value)))}>
          {(dna.target === 'local-devnet' ? [0, 1000, 2000, 5000, 12000] : [1000, 2000, 4000, 12000]).concat(base ? [2000] : []).filter((value, index, list) => list.indexOf(value) === index).map((value) => (
            <option key={value} value={value}>
              {value === 0 ? 'On every transaction' : `${value / 1000} s`}
            </option>
          ))}
        </select>
        {base && <small className="mf-hint">Set by Base.</small>}
      </label>
      <NumberInput id="dna-gas" label="Block gas limit" value={dna.network.gasLimit} locked={base ? 'Set by Base' : undefined} min={1_000_000} max={2_000_000_000} onChange={(value) => update((draft) => void (draft.network.gasLimit = value))} />
      {dna.target === 'local-devnet' && (
        <>
          <label className="mf-field" htmlFor="dna-fork">
            <span className="mono-label">Fork state from</span>
            <select
              id="dna-fork"
              className="input"
              value={dna.network.fork?.source ?? 'none'}
              onChange={(event) => update((draft) => void (draft.network.fork = event.target.value === 'none' ? null : { source: event.target.value as 'base' | 'base-sepolia', block: draft.network.fork?.block ?? null }))}
            >
              <option value="none">Nothing: empty chain</option>
              <option value="base">Base mainnet</option>
              <option value="base-sepolia">Base Sepolia</option>
            </select>
            <small className="mf-hint">A fork copies state into your devnet. Forked assets are not real and never return to Base.</small>
          </label>
          {dna.network.fork && (
            <NumberInput
              id="dna-fork-block"
              label="Fork block (empty = latest)"
              value={dna.network.fork.block}
              min={1}
              max={1_000_000_000}
              onChange={(value) => update((draft) => void (draft.network.fork = { ...draft.network.fork!, block: value }))}
            />
          )}
        </>
      )}
    </div>
  )
}

function EconomicsNumbers({ dna, update }: { dna: ChainDna; update: Update }) {
  const base = dna.target === 'base'
  const distribution = dna.economics.distribution
  const total = distribution.reduce((sum, item) => sum + item.pct, 0)
  return (
    <div className="dna-numbers">
      <NumberInput id="dna-fee" label="Base fee (gwei)" value={dna.economics.baseFeeGwei} locked={base ? 'Set by Base' : undefined} min={0} max={1000} step={0.001} onChange={(value) => update((draft) => void (draft.economics.baseFeeGwei = value))} />
      {dna.economics.token === 'erc20' && (
        <div className="dna-distribution">
          <p className="mono-label">
            Token distribution · {total}% of 100%
          </p>
          {distribution.map((item, index) => (
            <div key={index} className="dna-alloc">
              <input className="input" aria-label="Allocation label" value={item.label} maxLength={32} onChange={(event) => update((draft) => void (draft.economics.distribution[index].label = event.target.value))} />
              <input className="input" aria-label="Allocation percent" inputMode="numeric" value={item.pct} onChange={(event) => update((draft) => void (draft.economics.distribution[index].pct = Math.max(1, Math.min(100, Number(event.target.value.replace(/[^0-9]/g, '')) || 1))))} />
              <button type="button" className="icon-btn" aria-label="Remove allocation" onClick={() => update((draft) => void draft.economics.distribution.splice(index, 1))}>
                <Trash2 size={14} strokeWidth={1.8} />
              </button>
            </div>
          ))}
          {distribution.length < 8 && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => update((draft) => void draft.economics.distribution.push({ label: `Allocation ${draft.economics.distribution.length + 1}`, pct: Math.max(1, 100 - total) }))}>
              Add allocation
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function FieldIssues({ issues }: { issues: ReturnType<typeof validateDna> }) {
  if (!issues.length) return null
  return (
    <ul className="dna-issues" aria-live="polite">
      {issues.map((issue) => (
        <li key={`${issue.path}-${issue.message}`} className={`is-${issue.level}`}>
          <b>{issue.level === 'error' ? 'Incompatible' : 'Note'}</b> {issue.message}
        </li>
      ))}
    </ul>
  )
}
