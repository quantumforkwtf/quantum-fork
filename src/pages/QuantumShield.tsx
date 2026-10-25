import { Play, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { bytesToHex } from 'viem'
import type { BenchMessage, BenchRequest } from '../lab/pqWorker'
import { usePageMeta } from '../lib/meta'
import { calldataGas, CURVES_LIBRARY, type Keys, type Measurement, PQ_LIBRARY, SCHEME_BY_ID, SCHEMES, type SchemeId } from '../protocol/pqSignatures'
import { Link } from '../router'

const ms = (value: number | null) => (value === null ? '—' : value < 1 ? `${value.toFixed(3)} ms` : value < 100 ? `${value.toFixed(2)} ms` : `${Math.round(value).toLocaleString('en-US')} ms`)
const bytes = (value: number) => `${value.toLocaleString('en-US')} B`
const preview = (value: Uint8Array) => {
  const text = bytesToHex(value)
  return text.length > 74 ? `${text.slice(0, 40)}…${text.slice(-24)}` : text
}

function device() {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[]; platform: string } }).userAgentData
  const browser = brands?.brands.find((item) => !/not.?a.?brand|chromium/i.test(item.brand)) ?? brands?.brands[0]
  const name = browser ? `${browser.brand} ${browser.version}${brands?.platform ? ` · ${brands.platform}` : ''}` : navigator.userAgent.split(') ').pop() ?? navigator.userAgent
  return `${name} · ${navigator.hardwareConcurrency || '?'} logical cores`
}

export default function QuantumShield() {
  usePageMeta({ title: 'Quantum Shield', description: 'Post-quantum signatures (ML-DSA, SLH-DSA) next to the ECDSA keys Base uses today, measured on your own device with established libraries.', path: '/lab/quantum-shield' })
  const [results, setResults] = useState<Partial<Record<SchemeId, Measurement>>>({})
  const [failures, setFailures] = useState<Partial<Record<SchemeId, string>>>({})
  const [running, setRunning] = useState(false)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const worker = useRef<Worker | null>(null)

  useEffect(() => () => worker.current?.terminate(), [])

  function run() {
    worker.current?.terminate()
    const next = new Worker(new URL('../lab/pqWorker.ts', import.meta.url), { type: 'module' })
    worker.current = next
    setResults({})
    setFailures({})
    setRunning(true)
    setStartedAt(new Date().toLocaleString())
    next.onmessage = (event: MessageEvent<BenchMessage>) => {
      const message = event.data
      if (message.type === 'result') setResults((current) => ({ ...current, [message.measurement.id]: message.measurement }))
      else if (message.type === 'error') setFailures((current) => ({ ...current, [message.id]: message.message }))
      else {
        setRunning(false)
        next.terminate()
      }
    }
    next.onerror = () => {
      setRunning(false)
      setFailures((current) => ({ ...current, 'ecdsa-secp256k1': 'The benchmark worker failed to start.' }))
    }
    next.postMessage({ ids: SCHEMES.map((scheme) => scheme.id), budgetMs: 1500 } satisfies BenchRequest)
  }

  const done = Object.keys(results).length
  const baseline = results['ecdsa-secp256k1']

  return (
    <div className="gs qs">
      <header className="gs-head">
        <div>
          <p className="eyebrow">
            <Link to="/lab">Lab</Link> · Quantum Shield · experimental
          </p>
          <h1>Post-quantum signatures, measured here.</h1>
          <p className="section-lede">
            NIST’s post-quantum signature standards next to the ECDSA keys that secure Base today. Sizes and timings below come from running the real algorithms in this browser, nothing typed in.
          </p>
        </div>
      </header>

      <p className="callout is-warn qs-banner">
        <b>RESEARCH.</b> Base itself does not become quantum-resistant: its transactions, sequencer and bridges still rely on ECDSA. These signatures can only protect an account if a smart account verifies them, and no such verifier has been built or reviewed here. {PQ_LIBRARY.name} {PQ_LIBRARY.version}: {PQ_LIBRARY.audit}
      </p>

      <section className="gs-panel qs-bench" aria-label="Benchmark">
        <header className="rf-row qs-bench-head">
          <div>
            <p className="mono-label">Benchmark · this device</p>
            <small className="muted">{startedAt ? `${device()} · started ${startedAt}` : 'Runs in a background worker. About 30 seconds; SLH-DSA-128s signing is slow by design.'}</small>
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={running} onClick={run}>
            {done ? <RotateCcw size={14} strokeWidth={1.8} /> : <Play size={14} strokeWidth={1.8} />} {running ? `Measuring ${done + 1} of ${SCHEMES.length}…` : done ? 'Run again' : 'Run benchmark'}
          </button>
        </header>
        <div className="qs-table-wrap">
          <table className="gs-table qs-table">
            <thead>
              <tr>
                <th>Scheme</th>
                <th>Public key</th>
                <th>Signature</th>
                <th>Keygen</th>
                <th>Sign</th>
                <th>Verify</th>
                <th title="Gas to carry the signature in calldata (EIP-2028). Verification cost is not included.">Signature calldata</th>
              </tr>
            </thead>
            <tbody>
              {SCHEMES.map((scheme) => {
                const result = results[scheme.id]
                const failure = failures[scheme.id]
                return (
                  <tr key={scheme.id} className={scheme.quantumSafe ? 'is-pq' : 'is-classical'}>
                    <td>
                      <b>{scheme.label}</b>
                      <small>
                        {scheme.standard}
                        {scheme.category ? ` · NIST category ${scheme.category}` : ''} · {scheme.quantumSafe ? 'post-quantum' : 'not quantum-safe'}
                      </small>
                    </td>
                    {failure ? (
                      <td colSpan={6} className="field-error">
                        {failure}
                      </td>
                    ) : result ? (
                      <>
                        <td>{bytes(result.publicKeyBytes)}</td>
                        <td>
                          {bytes(result.signatureBytes)}
                          {baseline && scheme.id !== 'ecdsa-secp256k1' && <small>{(result.signatureBytes / baseline.signatureBytes).toFixed(0)}× ECDSA</small>}
                        </td>
                        <td>
                          {ms(result.keygenMs)}
                          <small>n={result.runs.keygen}</small>
                        </td>
                        <td>
                          {ms(result.signMs)}
                          <small>n={result.runs.sign}</small>
                        </td>
                        <td>
                          {ms(result.verifyMs)}
                          <small>n={result.runs.verify}</small>
                        </td>
                        <td>
                          {result.signatureCalldataGas.toLocaleString('en-US')} gas
                          <small>{result.verified && result.rejectedTamper ? 'verified · tamper rejected' : 'SELF-CHECK FAILED'}</small>
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} className="muted">
                        {running ? 'waiting…' : 'not measured'}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mf-hint">
          Medians of repeated runs within a 1.5 s budget per operation. Browsers coarsen timers, so sub-millisecond figures are approximate. Signature calldata is the EIP-2028 cost of carrying the bytes (16 gas per non-zero byte, 4 per zero byte); it excludes verification and Prague’s EIP-7623 calldata floor. Curves: {CURVES_LIBRARY.name} {CURVES_LIBRARY.version}.
        </p>
      </section>

      <Playground />

      <div className="qs-grid">
        <section className="gs-panel">
          <p className="mono-label">What it would take on Base</p>
          <ul className="readiness">
            <li className="is-ready">
              <span className="readiness-status">READY</span>
              <div>
                <b>Passkey accounts</b>
                <small>Base verifies P-256 natively (RIP-7212 precompile at 0x100), so ERC-4337 smart accounts can use passkeys cheaply. Passkeys are not quantum-safe.</small>
              </div>
            </li>
            <li className="is-planned">
              <span className="readiness-status">PLANNED</span>
              <div>
                <b>ML-DSA verifier contract</b>
                <small>Base has no ML-DSA precompile, so verification would run in EVM code. Its gas cost has not been measured; it will be reported from Anvil once a verifier exists.</small>
              </div>
            </li>
            <li className="is-planned">
              <span className="readiness-status">PLANNED</span>
              <div>
                <b>Post-quantum smart account</b>
                <small>An ERC-4337 account whose validation checks an ML-DSA signature. Needs the verifier, tests against tampered UserOperations, and an outside cryptographic review before it holds value.</small>
              </div>
            </li>
          </ul>
        </section>
        <section className="gs-panel">
          <p className="mono-label">What stays classical</p>
          <ul className="qs-list">
            <li>The transaction envelope. Base only accepts ECDSA-signed transactions, so a bundler or relayer still signs with secp256k1.</li>
            <li>Base’s sequencer, batcher and proposer keys, and the bridge to Ethereum.</li>
            <li>Any EOA key, including one delegated with EIP-7702: the original key keeps full control.</li>
            <li>Every other contract and token the account interacts with.</li>
          </ul>
        </section>
      </div>

      <p className="gs-fine">
        Algorithms come from {PQ_LIBRARY.name} {PQ_LIBRARY.version}; this site implements no cryptographic primitives. The test suite checks it against NIST ACVP vectors for ML-DSA key generation and signature verification and for SLH-DSA key generation. Keys generated on this page live only in memory and are never sent anywhere. Do not use them to protect anything.
      </p>
    </div>
  )
}

function Playground() {
  const [id, setId] = useState<SchemeId>('ml-dsa-44')
  const [keys, setKeys] = useState<Keys | null>(null)
  const [message, setMessage] = useState('Quantum Fork')
  const [signature, setSignature] = useState<Uint8Array | null>(null)
  const [tampered, setTampered] = useState(false)
  const [verdict, setVerdict] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const scheme = SCHEME_BY_ID[id]

  const later = (label: string, work: () => void) => {
    setBusy(label)
    setTimeout(() => {
      work()
      setBusy(null)
    }, 20)
  }
  const reset = (next: SchemeId) => {
    setId(next)
    setKeys(null)
    setSignature(null)
    setVerdict(null)
    setTampered(false)
  }
  const generate = () =>
    later('keygen', () => {
      setKeys(scheme.keygen())
      setSignature(null)
      setVerdict(null)
    })
  const sign = () =>
    later('sign', () => {
      if (!keys) return
      setSignature(scheme.sign(new TextEncoder().encode(message), keys.secretKey))
      setVerdict(null)
      setTampered(false)
    })
  const verify = () =>
    later('verify', () => {
      if (keys && shown) setVerdict(scheme.verify(shown, new TextEncoder().encode(message), keys.publicKey))
    })
  const shown = signature && tampered ? signature.map((byte, index) => (index === Math.floor(signature.length / 2) ? byte ^ 0x01 : byte)) : signature

  return (
    <section className="gs-panel qs-play" aria-label="Try it">
      <p className="mono-label">Try it · keys stay in this tab</p>
      <div className="rf-row">
        <label className="mf-field">
          <span>Scheme</span>
          <select className="input" value={id} onChange={(event) => reset(event.target.value as SchemeId)}>
            {SCHEMES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={generate}>
          {busy === 'keygen' ? 'Generating…' : '1 · Generate keys'}
        </button>
      </div>
      <p className="mf-hint">{scheme.note}</p>
      {keys && (
        <dl className="gs-hashes qs-keys">
          <div>
            <dt>Public key · {bytes(keys.publicKey.length)}</dt>
            <dd>
              <code>{preview(keys.publicKey)}</code>
            </dd>
          </div>
          <div>
            <dt>Secret key · {bytes(keys.secretKey.length)}</dt>
            <dd className="muted">held in memory, not shown</dd>
          </div>
        </dl>
      )}
      <label className="mf-field">
        <span>Message</span>
        <input
          className="input"
          value={message}
          maxLength={280}
          onChange={(event) => {
            setMessage(event.target.value)
            setVerdict(null)
          }}
        />
      </label>
      <div className="rf-row">
        <button type="button" className="btn btn-secondary btn-sm" disabled={!keys || !!busy} onClick={sign}>
          {busy === 'sign' ? 'Signing…' : '2 · Sign'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!keys || !shown || !!busy} onClick={verify}>
          {busy === 'verify' ? 'Verifying…' : '3 · Verify'}
        </button>
        <label className="rf-check">
          <input
            type="checkbox"
            checked={tampered}
            disabled={!signature}
            onChange={(event) => {
              setTampered(event.target.checked)
              setVerdict(null)
            }}
          />{' '}
          Flip one bit of the signature
        </label>
      </div>
      {shown && (
        <dl className="gs-hashes qs-keys">
          <div>
            <dt>
              Signature · {bytes(shown.length)} · {calldataGas(shown).toLocaleString('en-US')} calldata gas
            </dt>
            <dd>
              <code>{preview(shown)}</code>
            </dd>
          </div>
        </dl>
      )}
      {verdict !== null && <p className={`qs-verdict ${verdict ? 'is-ok' : 'is-bad'}`}>{verdict ? 'VALID: the signature matches this message and public key.' : 'INVALID: the signature does not match. Changing one bit, or one character of the message, is enough.'}</p>}
    </section>
  )
}
