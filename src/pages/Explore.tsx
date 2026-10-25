import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Architecture } from '../components/dna/Architecture'
import { Genome } from '../components/dna/Genome'
import { explorerAddress, explorerTx } from '../config'
import { api, ApiError } from '../lib/api'
import type { AnchorRecord, PublishedConfig } from '../lib/evm/anchor'
import { usePageMeta } from '../lib/meta'
import { shortAddress } from '../protocol/address'
import { type ChainDna, chosenOptions, encodeShare, infrastructure, LAYERS, readiness, SUPPORT, TARGETS } from '../protocol/chainDna'
import { Link } from '../router'

interface Summary {
  hash: `0x${string}`
  technicalHash: `0x${string}`
  dna: ChainDna
  publishedAt: string
  anchors: number
}

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string; status?: number }

function useApi<T>(path: string): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' })
  useEffect(() => {
    let live = true
    setLoad({ state: 'loading' })
    api<T>(path)
      .then(({ data }) => live && setLoad({ state: 'ok', data }))
      .catch((error) => live && setLoad({ state: 'error', message: error instanceof ApiError ? error.message : 'The server could not be reached.', status: error instanceof ApiError ? error.status : undefined }))
    return () => {
      live = false
    }
  }, [path])
  return load
}

export default function Explore() {
  usePageMeta({ title: 'Explore', description: 'Chain DNA configurations published to Quantum Fork, with their genomes, readiness and verified Base registry anchors.', path: '/explore' })
  const load = useApi<{ persistent: boolean; configs: Summary[] }>('/api/configs')
  return (
    <div className="explore">
      <header className="page-head">
        <p className="eyebrow">QFork Explore</p>
        <h1>Published configurations.</h1>
        <p className="section-lede">
          Every entry here was published to this server and validated on arrival. Anchors are Base registry records the server read back itself. No activity, users or network statistics are shown that were not recorded.
        </p>
        <div className="gs-row">
          <Link to="/create" className="btn btn-primary">
            Design one <ArrowRight size={15} strokeWidth={1.8} />
          </Link>
          <Link to="/network" className="btn btn-secondary">
            Registered descendants →
          </Link>
        </div>
      </header>
      {load.state === 'loading' && <p className="muted">Loading…</p>}
      {load.state === 'error' && <p className="callout is-warn">{load.message}</p>}
      {load.state === 'ok' && !load.data.persistent && <p className="callout">This server has no durable storage configured, so nothing can be published here. Configurations can still be exported and shared as links.</p>}
      {load.state === 'ok' && load.data.persistent && load.data.configs.length === 0 && <p className="muted">Nothing has been published yet.</p>}
      {load.state === 'ok' && load.data.configs.length > 0 && (
        <ul className="explore-list">
          {load.data.configs.map((item) => (
            <li key={item.hash}>
              <Link to={`/explore/${item.hash}`} className="explore-card">
                <Genome dna={item.dna} size={56} />
                <div>
                  <b>{item.dna.name}</b>
                  <small>
                    {TARGETS[item.dna.target].label} · {new Date(item.publishedAt).toLocaleDateString()} · {item.anchors ? `${item.anchors} anchor${item.anchors === 1 ? '' : 's'}` : 'not anchored'}
                  </small>
                  {item.dna.description && <span className="muted">{item.dna.description}</span>}
                </div>
                <code className="explore-hash">{shortAddress(item.hash, 8, 6)}</code>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ExploreDetail({ hash }: { hash: string }) {
  const load = useApi<{ config: PublishedConfig; anchors: AnchorRecord[] }>(`/api/configs?hash=${hash}`)
  const name = load.state === 'ok' ? load.data.config.dna.name : 'Configuration'
  usePageMeta({ title: `${name} · Explore`, description: 'A published Chain DNA configuration on Quantum Fork.', path: `/explore/${hash}` })
  if (load.state === 'loading') return <p className="muted page-head">Loading…</p>
  if (load.state === 'error')
    return (
      <div className="page-head not-found">
        <p className="eyebrow">QFork Explore</p>
        <h1>{load.status === 404 ? 'Not published here.' : 'Unavailable.'}</h1>
        <p className="section-lede">{load.message}</p>
        <Link to="/explore" className="btn btn-primary">
          All configurations
        </Link>
      </div>
    )
  const { config, anchors } = load.data
  const dna = config.dna
  const options = chosenOptions(dna)
  return (
    <div className="explore-detail">
      <header className="explore-detail-head">
        <Genome dna={dna} size={180} />
        <div>
          <p className="eyebrow">
            <Link to="/explore">Explore</Link> · {TARGETS[dna.target].label}
          </p>
          <h1>{dna.name}</h1>
          {dna.description && <p className="section-lede">{dna.description}</p>}
          <dl className="gs-hashes">
            <div>
              <dt>Document hash</dt>
              <dd>
                <code>{config.hash}</code>
              </dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{new Date(config.publishedAt).toLocaleString()}</dd>
            </div>
          </dl>
          <div className="gs-row">
            <Link to={`/create#dna=${encodeShare(dna)}`} className="btn btn-primary">
              Open in Genesis Studio
            </Link>
            <a className="btn btn-quiet" href={`/api/configs?hash=${config.hash}`} target="_blank" rel="noreferrer">
              Raw document
            </a>
          </div>
        </div>
      </header>

      <div className="explore-grid">
        <section className="gs-panel">
          <p className="mono-label">Registry anchors · {anchors.length}</p>
          {anchors.length === 0 ? (
            <p className="muted">Not anchored on Base. Anyone can anchor it from Genesis Studio.</p>
          ) : (
            <ul className="gs-infra">
              {anchors.map((anchor) => (
                <li key={anchor.recordId}>
                  <span>
                    <a href={explorerAddress(anchor.creator, anchor.network)} target="_blank" rel="noreferrer">
                      {shortAddress(anchor.creator)}
                    </a>{' '}
                    · v{anchor.version} · block {anchor.blockNumber.toLocaleString('en-US')}
                  </span>
                  <small>
                    <a href={explorerTx(anchor.txHash, anchor.network)} target="_blank" rel="noreferrer">
                      {anchor.network === 'base' ? 'Base' : 'Base Sepolia'} transaction
                    </a>{' '}
                    · verified {new Date(anchor.verifiedAt).toLocaleDateString()}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="gs-panel">
          <p className="mono-label">Readiness</p>
          <ul className="readiness">
            {readiness(dna).map((item) => (
              <li key={item.id} className={`is-${item.status}`}>
                <span className="readiness-status">{item.status.toUpperCase()}</span>
                <div>
                  <b>{item.label}</b>
                  <small>{item.detail}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="gs-panel">
          <p className="mono-label">Architecture</p>
          <Architecture dna={dna} />
          <ul className="gs-infra">
            {infrastructure(dna).map((item) => (
              <li key={item.component}>
                <span>{item.component}</span>
                <small>{item.operator}</small>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="gs-panel">
        <p className="mono-label">Configuration · {options.length} choices</p>
        <table className="gs-table">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Choice</th>
              <th>Layer</th>
              <th>On {TARGETS[dna.target].short.toLowerCase()}</th>
            </tr>
          </thead>
          <tbody>
            {options.map((item) => (
              <tr key={`${item.field.path}-${item.value}`}>
                <td>{item.field.label}</td>
                <td>{item.option.label}</td>
                <td>{LAYERS[item.field.layer]}</td>
                <td className={`support is-${item.support}`}>{SUPPORT[item.support].label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
