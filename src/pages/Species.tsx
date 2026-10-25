import { GitCompare, Maximize2, Minus, Plus, X } from 'lucide-react'
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { OriginBadge, Pill } from '../components/Status'
import { OrganismThumb } from '../components/Viewports'
import { ancestorOf, type Descendant, findDescendant, genomeOf, lineage, mergeServerDescendants, type Origin, useRegistry } from '../lab/registry'
import { api } from '../lib/api'
import { ageOf, formatNumber, useMediaQuery } from '../lib/hooks'
import { usePageMeta } from '../lib/meta'
import { navigate } from '../navigation'
import { ANCESTOR_NAME, DEFAULT_ANCESTOR, LOCUS_BY_CODE } from '../protocol/ancestors'
import { ancestorRows, type DescendantConfig, genomeDiff } from '../protocol/descendant'
import { stateLabel } from '../protocol/deployment'
import { quoteGenesis } from '../protocol/pricing'
import { PROFILE_BY_ID } from '../protocol/profiles'
import { Link } from '../router'

const COL = 250
const ROW = 190
const NODE_W = 190
const NODE_H = 164

interface Placed {
  item: Descendant
  col: number
  row: number
}

function layout(all: Descendant[]) {
  const children = new Map<string, Descendant[]>()
  for (const item of all) {
    if (!item.parentId) continue
    const parent = all.some((other) => other.id === item.parentId) ? item.parentId : (item.config?.ancestor ?? DEFAULT_ANCESTOR)
    children.set(parent, [...(children.get(parent) ?? []), item])
  }
  for (const list of children.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const nodes: Placed[] = []
  const edges: { from: Placed; to: Placed }[] = []
  let nextRow = 0
  const place = (item: Descendant, col: number): Placed => {
    const kids = (children.get(item.id) ?? []).map((kid) => place(kid, col + 1))
    const row = kids.length ? (kids[0].row + kids[kids.length - 1].row) / 2 : nextRow++
    const node = { item, col, row }
    nodes.push(node)
    kids.forEach((kid) => edges.push({ from: node, to: kid }))
    return node
  }
  for (const root of all.filter((item) => item.origin === 'ancestor')) place(root, 0)
  const cols = Math.max(1, ...nodes.map((node) => node.col + 1))
  return { nodes, edges, rows: Math.max(1, nextRow), cols }
}

const rowsFor = (item: Descendant) => (item.config ? genomeDiff(item.config) : ancestorRows(ancestorOf(item)))

function profileLabel(item: Descendant) {
  return item.config ? PROFILE_BY_ID[item.config.profile].name : 'CLASSICAL'
}

function nameOf(item: Descendant) {
  return item.config?.network.name ?? ANCESTOR_NAME[ancestorOf(item)]
}

function useServerDescendants() {
  useEffect(() => {
    api<{ descendants: { id: string; descendantId: string; config: DescendantConfig; createdAt: string }[] }>('/api/descendants', { timeoutMs: 6000 })
      .then(({ data }) => mergeServerDescendants(data.descendants))
      .catch(() => undefined)
  }, [])
}

function usePanZoom() {
  const [view, setView] = useState({ x: 24, y: 24, k: 1 })
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const clamp = (k: number) => Math.min(1.8, Math.max(0.4, k))
  const zoom = (factor: number, cx = 0, cy = 0) =>
    setView((current) => {
      const k = clamp(current.k * factor)
      const ratio = k / current.k
      return { k, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio }
    })
  const handlers = {
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || (event.target as HTMLElement).closest('a,button')) return
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const state = drag.current
      if (!state || state.id !== event.pointerId) return
      const dx = event.clientX - state.x
      const dy = event.clientY - state.y
      state.x = event.clientX
      state.y = event.clientY
      state.moved = true
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
    },
    onPointerUp() {
      drag.current = null
    },
  }
  return { view, zoom, handlers, reset: () => setView({ x: 24, y: 24, k: 1 }), dragging: () => drag.current?.moved ?? false }
}

function Board({ all, selected, onSelect, compare }: { all: Descendant[]; selected: string | null; onSelect: (id: string) => void; compare: string[] }) {
  const tree = useMemo(() => layout(all), [all])
  const [hover, setHover] = useState<string | null>(null)
  const { view, zoom, handlers, reset } = usePanZoom()
  const frame = useRef<HTMLDivElement>(null)
  const width = tree.cols * COL - (COL - NODE_W)
  const height = tree.rows * ROW - (ROW - NODE_H)
  const lit = useMemo(() => new Set(hover || selected ? lineage(all, (hover ?? selected) as string).map((item) => item.id) : []), [all, hover, selected])

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoom])

  return (
    <div className="explorer-frame panel" ref={frame} {...handlers}>
      <div className="explorer-gens" aria-hidden="true" style={{ transform: `translateX(${view.x}px) scale(${view.k})` }}>
        {Array.from({ length: tree.cols }, (_, index) => (
          <span key={index} style={{ width: index === tree.cols - 1 ? NODE_W : COL }}>
            GEN-{index}
            {index === 0 ? ' · ANCESTOR' : ''}
          </span>
        ))}
      </div>
      <div className="explorer-board" style={{ width, height, transform: `translate(${view.x}px, ${view.y + 28}px) scale(${view.k})` }}>
        <svg className="tree-wires" width={width} height={height} aria-hidden="true">
          {tree.edges.map(({ from, to }) => {
            const x1 = from.col * COL + NODE_W
            const y1 = from.row * ROW + NODE_H / 2
            const x2 = to.col * COL
            const y2 = to.row * ROW + NODE_H / 2
            const mid = x1 + (x2 - x1) / 2
            const bend = Math.sign(y2 - y1) * 10
            const d = y1 === y2 ? `M${x1} ${y1}H${x2}` : `M${x1} ${y1}H${mid - 10}Q${mid} ${y1} ${mid} ${y1 + bend}V${y2 - bend}Q${mid} ${y2} ${mid + 10} ${y2}H${x2}`
            return (
              <g key={`${from.item.id}-${to.item.id}`} className={lit.has(from.item.id) && lit.has(to.item.id) ? 'is-lit' : ''}>
                <path d={d} className="wire-outer" />
                <path d={d} className="wire-inner" />
                <circle cx={x1} cy={y1} r={4} className="wire-node" />
                <circle cx={x2} cy={y2} r={4} className="wire-node" />
              </g>
            )
          })}
        </svg>
        {tree.nodes.map(({ item, col, row }) => (
          <div
            key={item.id}
            className={`tree-node origin-${item.origin} ${lit.has(item.id) ? 'is-lit' : ''} ${selected === item.id ? 'is-selected' : ''} ${compare.includes(item.id) ? 'is-compared' : ''}`}
            style={{ left: col * COL, top: row * ROW, width: NODE_W, height: NODE_H }}
            onMouseEnter={() => setHover(item.id)}
            onMouseLeave={() => setHover(null)}
          >
            <button type="button" className="tree-card" onClick={() => onSelect(item.id)} onFocus={() => setHover(item.id)} onBlur={() => setHover(null)} aria-pressed={selected === item.id}>
              <span className="tree-code">{item.code}</span>
              <span className="tree-org">
                <OrganismThumb genome={genomeOf(item)} size={140} />
              </span>
              <strong>{nameOf(item)}</strong>
              <span className="tree-sub">
                {profileLabel(item)} · GEN-{item.generation}
              </span>
            </button>
          </div>
        ))}
      </div>
      <div className="explorer-tools" role="group" aria-label="Zoom">
        <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoom(1.2, 200, 160)}>
          <Plus size={15} strokeWidth={1.8} />
        </button>
        <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoom(1 / 1.2, 200, 160)}>
          <Minus size={15} strokeWidth={1.8} />
        </button>
        <button type="button" className="icon-btn" aria-label="Reset view" onClick={reset}>
          <Maximize2 size={14} strokeWidth={1.8} />
        </button>
        <span className="explorer-hint">Drag to pan · Ctrl/⌘ + scroll to zoom</span>
      </div>
    </div>
  )
}

function Outline({ all, onSelect }: { all: Descendant[]; onSelect: (id: string) => void }) {
  const render = (parentId: string | null, depth: number) => {
    const list = all.filter((item) => item.parentId === parentId)
    if (!list.length) return null
    return (
      <ul>
        {list.map((item) => (
          <li key={item.id} style={{ '--depth': depth } as CSSProperties}>
            <button type="button" className="outline-row" onClick={() => onSelect(item.id)}>
              <span className="outline-org">
                <OrganismThumb genome={genomeOf(item)} size={88} />
              </span>
              <span className="outline-text">
                <strong>{nameOf(item)}</strong>
                <small>
                  {item.code} · {profileLabel(item)} · GEN-{item.generation}
                </small>
              </span>
              <OriginBadge origin={item.origin} />
            </button>
            {render(item.id, depth + 1)}
          </li>
        ))}
      </ul>
    )
  }
  return <div className="tree-outline">{render(null, 0)}</div>
}

function Inspector({ item, all, onClose, onCompare, comparing }: { item: Descendant; all: Descendant[]; onClose: () => void; onCompare: () => void; comparing: boolean }) {
  const quote = item.config ? quoteGenesis(item.config) : null
  const chain = lineage(all, item.id)
  return (
    <aside className="inspector panel" aria-label={`${nameOf(item)} summary`}>
      <header>
        <div>
          <p className="mono-label">{item.code}</p>
          <h2>{nameOf(item)}</h2>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <X size={15} strokeWidth={1.8} />
        </button>
      </header>
      <OriginBadge origin={item.origin} />
      <dl className="report">
        <div>
          <dt>Ancestry</dt>
          <dd>{chain.map((link) => link.code).join(' → ')}</dd>
        </div>
        <div>
          <dt>Profile</dt>
          <dd>{profileLabel(item)}</dd>
        </div>
        <div>
          <dt>Generation</dt>
          <dd>GEN-{item.generation}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{item.origin === 'ancestor' ? 'MAINNET (EXTERNAL)' : item.origin === 'example' ? 'EXAMPLE DATA' : item.deployment ? stateLabel(item.deployment.state, item.deployment.burn.network) : 'UNKNOWN'}</dd>
        </div>
        {quote && (
          <div>
            <dt>Registration burn</dt>
            <dd>{formatNumber(quote.total)} QFORK</dd>
          </div>
        )}
        <div>
          <dt>Age</dt>
          <dd>{ageOf(item.createdAt)}</dd>
        </div>
      </dl>
      <div className="inspector-actions">
        <Link to={`/species/${item.id}`} className="btn btn-primary btn-sm">
          Specimen report
        </Link>
        <button type="button" className={`btn btn-secondary btn-sm ${comparing ? 'is-active' : ''}`} onClick={onCompare} aria-pressed={comparing}>
          <GitCompare size={13} strokeWidth={1.8} /> {comparing ? 'Comparing' : 'Compare'}
        </button>
        {item.origin !== 'ancestor' && item.config && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigate(`/lab?parent=${item.id}`)}>
            Fork this
          </button>
        )}
      </div>
    </aside>
  )
}

function Compare({ a, b, onClear }: { a: Descendant; b: Descendant; onClear: () => void }) {
  const left = rowsFor(a)
  const right = rowsFor(b)
  const changed = left.filter((row, index) => row.descendant !== right[index].descendant).length
  return (
    <section className="section compare panel" aria-label="Genome comparison">
      <header className="section-head-row">
        <div>
          <p className="eyebrow">Compare · {changed} loci differ</p>
          <h2>
            {nameOf(a)} <span className="muted">vs</span> {nameOf(b)}
          </h2>
        </div>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClear}>
          Clear
        </button>
      </header>
      <div className="diff" role="table">
        <div className="diff-row diff-head" role="row">
          <span role="columnheader">LOCUS</span>
          <span role="columnheader">{a.code}</span>
          <span role="columnheader">{b.code}</span>
        </div>
        {left.map((row, index) => {
          const other = right[index]
          const differs = row.descendant !== other.descendant
          return (
            <div key={row.code} className={`diff-row ${differs ? 'is-changed' : ''}`} role="row">
              <span role="cell">
                <code>{row.code}</code> {LOCUS_BY_CODE[row.code].name}
              </span>
              <span role="cell" className={row.changed ? 'diff-new' : 'diff-old'}>
                {row.descendant}
              </span>
              <span role="cell" className={other.changed ? 'diff-new' : 'diff-old'}>
                {other.descendant}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

const FILTERS: { id: 'all' | Origin; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'example', label: 'EXAMPLE DATA' },
  { id: 'registered', label: 'REGISTERED' },
]

export default function Species() {
  usePageMeta({ title: 'Descendants', description: 'Every descendant forked from Base or Solana, with lineage, profiles and genome comparison.', path: '/species' })
  useServerDescendants()
  const registry = useRegistry(4000)
  const compact = useMediaQuery('(max-width: 760px)')
  const [filter, setFilter] = useState<'all' | Origin>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [compare, setCompare] = useState<string[]>([])

  const visible = useMemo(() => {
    if (filter === 'all') return registry
    const keep = new Set<string>(registry.filter((item) => item.origin === 'ancestor').map((item) => item.id))
    for (const item of registry) if (item.origin === filter) lineage(registry, item.id).forEach((link) => keep.add(link.id))
    return registry.filter((item) => keep.has(item.id))
  }, [registry, filter])

  const selectedItem = selected ? findDescendant(registry, selected) : null
  const [a, b] = compare.map((id) => findDescendant(registry, id))
  const counts = {
    registered: registry.filter((item) => item.origin === 'registered').length,
    mainnet: registry.filter((item) => item.origin === 'registered' && item.deployment?.tier === 'mainnet').length,
    example: registry.filter((item) => item.origin === 'example').length,
  }

  const toggleCompare = (id: string) => setCompare((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id].slice(-2)))

  return (
    <div className="species-page">
      <header className="page-head">
        <p className="eyebrow">Descendant explorer · Roots: Base, Solana</p>
        <h1>The family tree.</h1>
        <p className="section-lede">
          Every descendant traces back to an ancestor chain: Base first, then Solana. Example entries illustrate the explorer and are never counted as activity. Registered descendants were each created by a burn
          the server verified on-chain.
        </p>
        <div className="explorer-bar">
          <div className="chips" role="group" aria-label="Filter descendants">
            {FILTERS.map((item) => (
              <button key={item.id} type="button" className={`chip ${filter === item.id ? 'is-active' : ''}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                {item.label}
                {item.id !== 'all' && <small> {counts[item.id as keyof typeof counts]}</small>}
              </button>
            ))}
          </div>
          <Pill
            label={counts.registered - counts.mainnet > 0 ? `${counts.registered - counts.mainnet} ON DEVNET · ${counts.mainnet} ON MAINNET` : `${counts.mainnet} ON MAINNET`}
            tone="var(--cyan)"
          />
        </div>
      </header>

      <div className={`explorer ${selectedItem ? 'has-inspector' : ''}`}>
        {compact ? <Outline all={visible} onSelect={setSelected} /> : <Board all={visible} selected={selected} onSelect={setSelected} compare={compare} />}
        {selectedItem && <Inspector item={selectedItem} all={registry} onClose={() => setSelected(null)} onCompare={() => toggleCompare(selectedItem.id)} comparing={compare.includes(selectedItem.id)} />}
      </div>

      {a && b ? (
        <Compare a={a} b={b} onClear={() => setCompare([])} />
      ) : (
        compare.length === 1 && (
          <p className="callout compare-hint">
            Comparing {findDescendant(registry, compare[0])?.code}. Select another descendant and press Compare.
          </p>
        )
      )}

      <section className="section cta-band panel">
        <div>
          <p className="eyebrow">Grow the tree</p>
          <h2>Fork Base into a new descendant.</h2>
        </div>
        <Link to="/lab" className="btn btn-primary btn-lg">
          Open the lab
        </Link>
      </section>
    </div>
  )
}
