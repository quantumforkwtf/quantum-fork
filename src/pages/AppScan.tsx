import { ArrowRight, Download, FileCode2, FolderOpen, Github, Link2, ScanLine, X } from 'lucide-react'
import { type CSSProperties, type DragEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { BlueprintStatusBadge } from '../components/Blueprint'
import { Pill } from '../components/Status'
import { CLIENT_CONFIG } from '../config'
import { api, ApiError } from '../lib/api'
import { usePageMeta } from '../lib/meta'
import { copyText } from '../lib/toast'
import { navigate, useLocation } from '../navigation'
import {
  type AppScanReport,
  AppScanner,
  locationUrl,
  parseRepoInput,
  reportToMarkdown,
  RISK_LABEL,
  RISK_MEANING,
  SCAN_LIMITS,
  type ScanRisk,
  scanTexts,
  SURFACE_LABEL,
  type SurfaceResult,
} from '../protocol/appScan'
import { blueprintLabHref, recommendedStatus } from '../protocol/blueprintCompiler'
import { BLUEPRINT_BY_SLUG } from '../protocol/blueprints'
import { Link } from '../router'

const BLUEPRINT = BLUEPRINT_BY_SLUG['quantumize-my-app']

type Mode = 'github' | 'local' | 'paste'
type Run = { state: 'idle' } | { state: 'running'; label: string; done?: number; total?: number } | { state: 'error'; message: string } | { state: 'done'; report: AppScanReport }

const MODES: { id: Mode; label: string }[] = [
  { id: 'github', label: 'GitHub repository' },
  { id: 'local', label: 'Local folder' },
  { id: 'paste', label: 'Paste code' },
]

const EXAMPLES = ['panva/jose', 'paulmillr/noble-post-quantum', 'anza-xyz/wallet-adapter']

const RISK_TONE: Record<ScanRisk, string> = {
  BROKEN: 'var(--red)',
  WEAKENED: 'var(--yellow)',
  REVIEW: 'var(--orange)',
  CLASSICAL: 'var(--purple)',
  PQ: 'var(--lime)',
}

const SAMPLE = `import https from 'node:https'
import { createECDH, createHash, createCipheriv } from 'node:crypto'
import jwt from 'jsonwebtoken'

// Session tokens
export const issue = (user: string) => jwt.sign({ sub: user }, privateKey, { algorithm: 'RS256', expiresIn: '1h' })

// End-to-end messages
const ecdh = createECDH('prime256v1')
export const sharedKey = (peer: Buffer) => ecdh.computeSecret(peer)
export const seal = (key: Buffer, iv: Buffer) => createCipheriv('aes-128-gcm', key, iv)

// File fingerprints
export const fingerprint = (data: Buffer) => createHash('sha1').update(data).digest('hex')

// Wallet sign-in
export const verifyLogin = async (wallet: Wallet, nonce: Uint8Array) => wallet.signMessage(nonce)

https.createServer({ key, cert }, app).listen(443)
`

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function slugOf(report: AppScanReport) {
  return report.source.label.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'scan'
}

const pause = () => new Promise((resolve) => window.setTimeout(resolve, 0))

/* ---------- folder reading ---------- */

interface PickedFile {
  path: string
  file: File
}

function fromInput(list: FileList): PickedFile[] {
  return Array.from(list, (file) => {
    const relative = file.webkitRelativePath || file.name
    return { path: relative, file }
  })
}

async function fromDrop(event: DragEvent): Promise<PickedFile[]> {
  const out: PickedFile[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (out.length > 50_000) return
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      out.push({ path: `${prefix}${entry.name}`, file })
      return
    }
    if (!entry.isDirectory) return
    if (['node_modules', '.git', 'dist', 'build', 'target', '.venv', 'vendor'].includes(entry.name)) return
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (!batch.length) break
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
    }
  }
  const entries = Array.from(event.dataTransfer.items, (item) => item.webkitGetAsEntry()).filter((entry): entry is FileSystemEntry => Boolean(entry))
  for (const entry of entries) await walk(entry, '')
  return out
}

/** Every file is read and scanned in this tab. Nothing is uploaded. */
async function scanPicked(picked: PickedFile[], onProgress: (done: number, total: number) => void, cancelled: () => boolean) {
  const roots = new Set(picked.map((item) => item.path.split('/')[0]))
  const single = roots.size === 1 && picked.every((item) => item.path.includes('/'))
  const label = single ? [...roots][0] : picked.length === 1 ? picked[0].path : `${picked.length} files`
  const scanner = new AppScanner()
  for (let index = 0; index < picked.length; index++) {
    if (cancelled()) {
      scanner.markTruncated('Stopped by you before every file was read.')
      break
    }
    const { file } = picked[index]
    const path = single ? picked[index].path.slice(picked[index].path.indexOf('/') + 1) : picked[index].path
    const kind = scanner.admit(path, file.size)
    if (kind) scanner.addFile(path, await file.text(), kind)
    if (index % 40 === 0) {
      onProgress(index, picked.length)
      await pause()
    }
  }
  return scanner.report({ kind: 'local', label })
}

/* ---------- report ---------- */

function Surface({ surface, index, report }: { surface: SurfaceResult; index: number; report: AppScanReport }) {
  const [all, setAll] = useState(false)
  const shown = all ? surface.locations : surface.locations.slice(0, 6)
  const elsewhere = surface.occurrences - surface.sourceOccurrences - surface.hybridOccurrences
  return (
    <li className="as-surface" style={{ '--tone': RISK_TONE[surface.risk] } as CSSProperties}>
      <header>
        <span className="as-surface-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="as-surface-title">
          <span className="mono-label">{SURFACE_LABEL[surface.surface]}</span>
          <h3>{surface.title}</h3>
        </div>
        <div className="as-surface-tags">
          <Pill label={RISK_LABEL[surface.risk]} tone={RISK_TONE[surface.risk]} title={RISK_MEANING[surface.risk]} />
          {surface.harvestNow && surface.risk === 'BROKEN' && <Pill label="HARVEST NOW" tone="var(--red)" title="Data or traffic recorded today could be decrypted later." />}
          {!surface.inApp && <Pill label="OUTSIDE YOUR APP" tone="var(--cyan)" title="Set by a chain, a certificate authority or another party." />}
        </div>
      </header>
      <p className="as-surface-count">
        {surface.occurrences.toLocaleString('en-US')} {surface.occurrences === 1 ? 'occurrence' : 'occurrences'} in {surface.files.toLocaleString('en-US')} {surface.files === 1 ? 'file' : 'files'}
        {surface.hybridOccurrences > 0 && <b> · {surface.hybridOccurrences.toLocaleString('en-US')} beside a post-quantum primitive</b>}
        {elsewhere > 0 && <span> · {elsewhere.toLocaleString('en-US')} in tests, examples or comments</span>}
      </p>
      <dl className="as-surface-body">
        <div>
          <dt>Why it matters</dt>
          <dd>{surface.why}</dd>
        </div>
        <div>
          <dt>{surface.risk === 'PQ' ? 'Check' : 'Replace with'}</dt>
          <dd>{surface.fix}</dd>
        </div>
        {surface.standard && (
          <div>
            <dt>Standard</dt>
            <dd>{surface.standard}</dd>
          </div>
        )}
      </dl>
      <ul className="as-locations" aria-label={`${surface.title} locations`}>
        {shown.map((location) => {
          const href = locationUrl(report.source, location)
          const where = `${location.path}:${location.line}`
          return (
            <li key={where} className={location.test || location.comment ? 'is-quiet' : location.hybrid ? 'is-hybrid' : ''}>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer noopener" className="as-where">
                  {where}
                </a>
              ) : (
                <span className="as-where">{where}</span>
              )}
              {(location.test || location.comment || location.hybrid) && <em>{location.test ? 'test or example' : location.comment ? 'comment' : 'hybrid with post-quantum'}</em>}
              <code>{location.excerpt}</code>
            </li>
          )
        })}
      </ul>
      {surface.locations.length > 6 && (
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show ${surface.locations.length - 6} more${surface.occurrences > surface.locations.length ? ` of ${surface.occurrences.toLocaleString('en-US')}` : ''}`}
        </button>
      )}
    </li>
  )
}

function Report({ report }: { report: AppScanReport }) {
  const { summary, stats, source } = report
  const elsewhere = summary.vulnerable - summary.vulnerableInCode - summary.hybrid
  const tally: { label: string; value: number; tone: string; title: string }[] = [
    { label: 'QUANTUM-VULNERABLE', value: summary.vulnerable, tone: 'var(--red)', title: RISK_MEANING.BROKEN },
    { label: 'HARVEST-NOW RISK', value: summary.harvestNow, tone: 'var(--red)', title: 'Key exchange, encryption and transport: recorded data could be decrypted later.' },
    { label: 'OUTSIDE YOUR APP', value: summary.outsideApp, tone: 'var(--cyan)', title: 'Set by a chain or a certificate authority.' },
    { label: 'QUANTUM-WEAKENED', value: summary.weakened, tone: 'var(--yellow)', title: RISK_MEANING.WEAKENED },
    { label: 'WEAK TODAY', value: summary.classical, tone: 'var(--purple)', title: RISK_MEANING.CLASSICAL },
    { label: 'POST-QUANTUM', value: summary.postQuantum, tone: 'var(--lime)', title: RISK_MEANING.PQ },
  ]
  const languages = Object.entries(stats.languages).sort((a, b) => b[1] - a[1])
  const skipped = Object.values(stats.skipped).reduce((total, count) => total + (count ?? 0), 0)
  const shareUrl = source.kind === 'github' ? `${CLIENT_CONFIG.siteUrl}/quantumize?repo=${source.label}${source.ref ? `&ref=${source.ref}` : ''}` : null

  return (
    <section className="as-report" aria-labelledby="as-report-title">
      <header className="as-report-head">
        <p className="mono-label">
          Report · {source.kind === 'github' ? 'github.com/' : ''}
          {source.label}
          {source.commit && (
            <>
              {' '}
              @{' '}
              <a href={`${source.url}/tree/${source.commit}`} target="_blank" rel="noreferrer noopener">
                {source.commit.slice(0, 7)}
              </a>
            </>
          )}{' '}
          · {stats.filesScanned.toLocaleString('en-US')} {stats.filesScanned === 1 ? 'file' : 'files'} scanned · {(report.durationMs / 1000).toFixed(1)}s
        </p>
        <h2 id="as-report-title">{summary.verdict}</h2>
        {(summary.vulnerable > 0 || summary.postQuantum > 0) && (
          <p className="as-report-sub">
            {summary.hybrid > 0 && `${summary.hybrid.toLocaleString('en-US')} more sit beside a post-quantum primitive, likely as half of a hybrid. `}
            {elsewhere > 0 && `${elsewhere.toLocaleString('en-US')} more in tests, examples and comments, across ${summary.vulnerableFiles.toLocaleString('en-US')} files in all. `}
            {summary.postQuantum > 0 && `Post-quantum primitives appear ${summary.postQuantum.toLocaleString('en-US')} ${summary.postQuantum === 1 ? 'time' : 'times'}. `}
            {report.surfaces.length > 1 && 'Ranked below by what to fix first.'}
          </p>
        )}
        {stats.truncated && <p className="as-report-warn">{stats.truncated} The report covers what was read.</p>}
        <div className="as-report-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => download(`quantum-report-${slugOf(report)}.md`, 'text/markdown', reportToMarkdown(report))}>
            <Download size={14} strokeWidth={1.8} /> Markdown
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => download(`quantum-report-${slugOf(report)}.json`, 'application/json', JSON.stringify(report, null, 2))}>
            <Download size={14} strokeWidth={1.8} /> JSON
          </button>
          {shareUrl && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void copyText(shareUrl, 'Report link copied.')}>
              <Link2 size={14} strokeWidth={1.8} /> Copy link
            </button>
          )}
        </div>
      </header>

      <dl className="as-tally">
        {tally.map((item) => (
          <div key={item.label} style={{ '--tone': item.tone } as CSSProperties} className={item.value ? '' : 'is-zero'} title={item.title}>
            <dt>{item.label}</dt>
            <dd>{item.value.toLocaleString('en-US')}</dd>
          </div>
        ))}
      </dl>

      {report.surfaces.length > 0 ? (
        <ol className="as-surfaces">
          {report.surfaces.map((surface, index) => (
            <Surface key={surface.ruleId} surface={surface} index={index} report={report} />
          ))}
        </ol>
      ) : (
        <p className="as-empty">
          No matches in {stats.filesScanned.toLocaleString('en-US')} files. That is a good sign, not a guarantee: cryptography can live in dependencies, the runtime, or the host that terminates TLS.
        </p>
      )}

      {report.dependencies.length > 0 && (
        <div className="as-deps">
          <h3 className="mono-label">Dependencies · {report.dependencies.length}</h3>
          <ul>
            {report.dependencies.map((dep) => (
              <li key={`${dep.ecosystem}:${dep.name}`} style={{ '--tone': RISK_TONE[dep.risk] } as CSSProperties}>
                <code>{dep.name}</code>
                <span className="as-dep-meta">
                  {dep.ecosystem} · {dep.manifest}
                </span>
                <span className="as-dep-provides">{dep.provides}</span>
                <Pill label={RISK_LABEL[dep.risk]} tone={RISK_TONE[dep.risk]} title={dep.fix} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="as-stats">
        {languages.length > 0 && <>Scanned {languages.map(([language, count]) => `${language} ${count}`).join(' · ')}. </>}
        {skipped > 0 && (
          <>
            Skipped {skipped.toLocaleString('en-US')} of {stats.filesSeen.toLocaleString('en-US')} files (dependencies, lockfiles, docs, generated or over {SCAN_LIMITS.maxFileBytes / 1024} KB).{' '}
          </>
        )}
        Scanner v{report.version}.
      </p>
    </section>
  )
}

/* ---------- page ---------- */

export default function AppScan() {
  usePageMeta({
    title: 'Quantumize My App',
    description: 'Scan a GitHub repository or a local folder for the cryptography a quantum computer would break, with a post-quantum replacement for every finding.',
    path: '/quantumize',
    image: '/api/og?blueprint=quantumize-my-app',
  })
  const { query } = useLocation()
  const [mode, setMode] = useState<Mode>('github')
  const [repo, setRepo] = useState(() => query.get('repo') ?? '')
  const [paste, setPaste] = useState('')
  const [pasteName, setPasteName] = useState('server.ts')
  const [run, setRun] = useState<Run>({ state: 'idle' })
  const [dragging, setDragging] = useState(false)
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef(false)
  const autoRan = useRef(false)
  const running = run.state === 'running'

  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '')
  }, [mode])

  const finish = (report: AppScanReport) => {
    setRun({ state: 'done', report })
    requestAnimationFrame(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const scanRepo = async (input: string, ref?: string | null) => {
    const parsed = parseRepoInput(input, ref)
    if (!parsed) {
      setRun({ state: 'error', message: 'Enter a public GitHub repository as owner/name, or paste its github.com URL.' })
      return
    }
    const label = `${parsed.owner}/${parsed.name}`
    navigate(`/quantumize?repo=${label}${parsed.ref ? `&ref=${parsed.ref}` : ''}`, { replace: true, keepScroll: true })
    setRun({ state: 'running', label: `Downloading and scanning github.com/${label}${parsed.ref ? ` @ ${parsed.ref}` : ''}` })
    try {
      const { data } = await api<AppScanReport>(`/api/scan?repo=${encodeURIComponent(label)}${parsed.ref ? `&ref=${encodeURIComponent(parsed.ref)}` : ''}`, { timeoutMs: 75_000 })
      finish(data)
    } catch (error) {
      setRun({ state: 'error', message: error instanceof ApiError ? error.message : 'The scan failed. Try again.' })
    }
  }

  useEffect(() => {
    if (autoRan.current) return
    autoRan.current = true
    const initial = query.get('repo')
    if (initial) void scanRepo(initial, query.get('ref'))
    // Runs once for shared report links.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scanLocal = async (picked: PickedFile[]) => {
    if (!picked.length) return
    cancelRef.current = false
    setRun({ state: 'running', label: 'Reading files in this tab', done: 0, total: picked.length })
    try {
      const report = await scanPicked(picked, (done, total) => setRun({ state: 'running', label: 'Reading files in this tab', done, total }), () => cancelRef.current)
      finish(report)
    } catch {
      setRun({ state: 'error', message: 'Some files could not be read. Try choosing the folder again.' })
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void scanRepo(repo)
  }

  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (running) return
    void scanLocal(await fromDrop(event))
  }

  const scanPaste = () => {
    if (!paste.trim()) {
      setRun({ state: 'error', message: 'Paste some code first, or load the sample.' })
      return
    }
    const name = pasteName.trim().replace(/^\/+/, '') || 'snippet.ts'
    finish(scanTexts([{ path: name, text: paste.slice(0, SCAN_LIMITS.maxFileBytes) }], { kind: 'paste', label: name }))
  }

  const index = MODES.findIndex((item) => item.id === mode)

  return (
    <div className="appscan">
      <header className="page-head">
        <p className="eyebrow">
          <Link to={`/blueprints/${BLUEPRINT.slug}`}>Blueprint // {BLUEPRINT.id}</Link> · {BLUEPRINT.name}
        </p>
        <h1>Find the cryptography a quantum computer breaks.</h1>
        <p className="section-lede">
          Scan an app’s code for RSA, elliptic-curve and Diffie-Hellman usage, signed tokens, TLS and SSH configuration, committed keys and crypto dependencies. Every finding comes with its post-quantum replacement, ranked by what to fix first.
        </p>
        <div className="as-pills">
          <BlueprintStatusBadge status={recommendedStatus(BLUEPRINT)} />
          <Pill label="FREE · NO BURN" tone="var(--muted)" />
        </div>
      </header>

      <section className="as-input panel" aria-label="What to scan">
        <div className="segmented as-modes" role="tablist" aria-label="Source" style={{ '--n': MODES.length, '--i': index, '--accent': 'var(--lime)' } as CSSProperties}>
          <span className="segmented-thumb" aria-hidden="true" />
          {MODES.map((item) => (
            <button key={item.id} type="button" role="tab" id={`as-tab-${item.id}`} aria-selected={item.id === mode} aria-controls={`as-panel-${item.id}`} className={item.id === mode ? 'is-active' : ''} onClick={() => setMode(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        {mode === 'github' && (
          <div role="tabpanel" id="as-panel-github" aria-labelledby="as-tab-github" className="as-panel">
            <form className="as-repo" onSubmit={onSubmit}>
              <label className="field-label" htmlFor="as-repo-input">
                Public repository
              </label>
              <div className="as-repo-row">
                <Github size={18} strokeWidth={1.6} aria-hidden="true" />
                <input
                  id="as-repo-input"
                  value={repo}
                  onChange={(event) => setRepo(event.target.value)}
                  placeholder="owner/repo or https://github.com/owner/repo"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  maxLength={300}
                  disabled={running}
                />
                <button type="submit" className="btn btn-primary" disabled={running || !repo.trim()}>
                  <ScanLine size={15} strokeWidth={1.8} /> {running ? 'Scanning' : 'Scan repository'}
                </button>
              </div>
            </form>
            <div className="as-examples">
              <span className="mono-label">Try</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="chip"
                  disabled={running}
                  onClick={() => {
                    setRepo(example)
                    void scanRepo(example)
                  }}
                >
                  {example}
                </button>
              ))}
            </div>
            <p className="as-privacy">The server downloads the public archive from GitHub, scans it in memory and discards it. No code is stored. For private code, use a local folder.</p>
          </div>
        )}

        {mode === 'local' && (
          <div role="tabpanel" id="as-panel-local" aria-labelledby="as-tab-local" className="as-panel">
            <div
              className={`as-drop ${dragging ? 'is-over' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => void onDrop(event)}
            >
              <FolderOpen size={26} strokeWidth={1.4} aria-hidden="true" />
              <p>
                <strong>Drop a project folder here</strong>
                <span>Files are read in this tab and never uploaded.</span>
              </p>
              <div className="as-drop-actions">
                <button type="button" className="btn btn-primary" disabled={running} onClick={() => folderRef.current?.click()}>
                  <FolderOpen size={15} strokeWidth={1.8} /> Choose a folder
                </button>
                <button type="button" className="btn btn-quiet" disabled={running} onClick={() => filesRef.current?.click()}>
                  <FileCode2 size={15} strokeWidth={1.8} /> Choose files
                </button>
              </div>
              <input
                ref={folderRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files) void scanLocal(fromInput(event.target.files))
                  event.target.value = ''
                }}
              />
              <input
                ref={filesRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files) void scanLocal(fromInput(event.target.files))
                  event.target.value = ''
                }}
              />
            </div>
            <p className="as-privacy">Your browser may ask to confirm the upload; that is its standard wording for letting this page read the folder. Nothing is sent anywhere. node_modules, .git, build output and .env files are skipped.</p>
          </div>
        )}

        {mode === 'paste' && (
          <div role="tabpanel" id="as-panel-paste" aria-labelledby="as-tab-paste" className="as-panel">
            <div className="as-paste-head">
              <label className="field-label" htmlFor="as-paste-name">
                File name
              </label>
              <input id="as-paste-name" className="as-paste-name" value={pasteName} onChange={(event) => setPasteName(event.target.value)} spellCheck={false} autoComplete="off" maxLength={120} />
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPaste(SAMPLE)}>
                Load a sample
              </button>
            </div>
            <textarea className="as-paste" value={paste} onChange={(event) => setPaste(event.target.value)} spellCheck={false} placeholder="Paste source code or configuration" aria-label="Code to scan" rows={12} />
            <div className="as-paste-foot">
              <p className="as-privacy">Scanned in your browser. The file name sets the language.</p>
              <button type="button" className="btn btn-primary" onClick={scanPaste}>
                <ScanLine size={15} strokeWidth={1.8} /> Scan code
              </button>
            </div>
          </div>
        )}
      </section>

      <div ref={reportRef} className="as-result" aria-live="polite">
        {run.state === 'running' && (
          <div className="as-progress panel" role="status">
            <span className="as-progress-bar" aria-hidden="true">
              <i style={run.total ? { width: `${Math.round(((run.done ?? 0) / run.total) * 100)}%`, animation: 'none' } : undefined} />
            </span>
            <p>
              {run.label}
              {run.total ? ` · ${(run.done ?? 0).toLocaleString('en-US')} of ${run.total.toLocaleString('en-US')}` : '…'}
            </p>
            {run.total ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => (cancelRef.current = true)}>
                <X size={14} strokeWidth={1.8} /> Stop
              </button>
            ) : null}
          </div>
        )}
        {run.state === 'error' && (
          <p className="as-error" role="alert">
            {run.message}
          </p>
        )}
        {run.state === 'done' && <Report report={run.report} />}
      </div>

      <section className="section as-method" aria-labelledby="as-method-title">
        <header className="section-head">
          <p className="eyebrow">How it works</p>
          <h2 id="as-method-title">What it checks, and what it can’t.</h2>
        </header>
        <div className="as-method-grid">
          <div>
            <h3>What it finds</h3>
            <p>Calls and identifiers for RSA, ECDSA, Ed25519, ECDH, X25519 and Diffie-Hellman; JWT algorithms; TLS and SSH settings; committed private keys and certificates; AES-128 and legacy hashes; and crypto libraries in package manifests. It also notices post-quantum primitives you already use.</p>
          </div>
          <div>
            <h3>How it ranks</h3>
            <p>Key exchange and encryption come first: anything recorded today can be decrypted once a large quantum computer exists. Signatures follow, then what only a chain or a certificate authority can change, then weakened and legacy primitives.</p>
          </div>
          <div>
            <h3>What it can’t see</h3>
            <p>It matches text; it does not run or trace code. Cryptography inside dependencies, the runtime, your host or your CDN is invisible to it, so check TLS with whoever terminates it. Review each finding before acting on it.</p>
            <Link to={blueprintLabHref(BLUEPRINT)} className="btn btn-quiet btn-sm as-method-link">
              Map what code can’t show <ArrowRight size={14} strokeWidth={1.8} />
            </Link>
          </div>
        </div>
      </section>

      <section className="section cta-band panel">
        <div>
          <p className="eyebrow">Next</p>
          <h2>Your app runs on a chain?</h2>
          <p className="section-lede">Wallet signatures belong to the chain. See what a post-quantum descendant of Solana would change.</p>
        </div>
        <Link to="/scanner" className="btn btn-primary btn-lg">
          Scan Solana <ArrowRight size={16} strokeWidth={1.8} />
        </Link>
      </section>
    </div>
  )
}
