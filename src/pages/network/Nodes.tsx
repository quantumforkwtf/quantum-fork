import { Copy, Download, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAddress, type Hex, isAddress, isAddressEqual, toHex } from 'viem'
import { BaseWalletPanel } from '../../components/BaseWallet'
import { ConsoleSection, EmptyState } from '../../components/network/Parts'
import { api } from '../../lib/api'
import { evmProvider, useEvmWallet } from '../../lib/evm/wallet'
import { type DirectoryNode, errorText, type NodeDirectory, useNodeDirectory } from '../../lib/nodeDirectory'
import { type TabProps, timestamp } from '../../lib/networkUi'
import { copyText, toast } from '../../lib/toast'
import { useLocation } from '../../navigation'
import { shortAddress } from '../../protocol/address'
import {
  BESU_VERSION,
  faultTolerance,
  isPublicRpcUrl,
  listingMessage,
  MAX_GENESIS_VALIDATORS,
  type NodeListing,
  ownerAlloc,
  parseEnode,
  quorum,
  removalMessage,
  type SealedSpec,
  sealMessage,
  validateListing,
} from '../../protocol/nodes'

type Directory = NodeDirectory

const REPO = 'https://github.com/quantumforkwtf/quantum-fork'
const LOCAL_GATEWAY = 'http://127.0.0.1:8545'
const RPC_STORAGE = 'qfork.nodes.rpc'
const now = () => Math.floor(Date.now() / 1000)

function Command({ text }: { text: string }) {
  return (
    <div className="nc-cmd">
      <code>{text}</code>
      <button type="button" className="icon-btn" aria-label={`Copy: ${text}`} onClick={() => void copyText(text, 'Command copied.')}>
        <Copy size={13} strokeWidth={1.8} />
      </button>
    </div>
  )
}

async function personalSign(address: Hex, message: string) {
  return (await evmProvider().request({ method: 'personal_sign', params: [toHex(message), address] })) as Hex
}

/* ---------- reading a node from the browser ---------- */

interface Live {
  chainId: number
  block: number
  peers: number | null
  validators: Hex[] | null
  at: number
}

async function rpcCall<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(6000) })
  const body = (await response.json()) as { result?: T; error?: { message: string } }
  if (body.error) throw new Error(body.error.message)
  return body.result as T
}

const usableRpc = (url: string) => isPublicRpcUrl(url) || /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/?$/.test(url)

function useLive(url: string | null) {
  const [live, setLive] = useState<Live | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setLive(null)
    setError(null)
    if (!url) return
    let cancelled = false
    const read = async () => {
      try {
        const [chainId, block, peers, validators] = await Promise.all([
          rpcCall<Hex>(url, 'eth_chainId'),
          rpcCall<Hex>(url, 'eth_blockNumber'),
          rpcCall<Hex>(url, 'net_peerCount').catch(() => null),
          rpcCall<Hex[]>(url, 'qbft_getValidatorsByBlockNumber', ['latest']).catch(() => null),
        ])
        if (cancelled) return
        setLive({ chainId: Number(chainId), block: Number(block), peers: peers === null ? null : Number(peers), validators, at: Date.now() })
        setError(null)
      } catch {
        if (!cancelled) setError(`No node answered at ${url}.`)
      }
    }
    void read()
    const timer = window.setInterval(read, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [url])
  return { live, error }
}

function LiveNetwork({ directory, rpc, setRpc }: { directory: Directory; rpc: string | null; setRpc: (url: string | null) => void }) {
  const [draft, setDraft] = useState(rpc ?? LOCAL_GATEWAY)
  useEffect(() => setDraft(rpc ?? LOCAL_GATEWAY), [rpc])
  const { live, error } = useLive(rpc)
  const expected = directory.descendant.params.chainId
  const labels = new Map(directory.nodes.map((node) => [node.id, node.listing.label || shortAddress(getAddress(node.id))]))
  const wrongChain = live && live.chainId !== expected
  const valid = usableRpc(draft.trim())
  return (
    <ConsoleSection code="02" title="Live" className="is-wide" id="live" aside={live && !wrongChain ? <span className="nc-tag">LIVE</span> : <span className="nc-tag is-off">NOT CONNECTED</span>}>
      <p className="muted">Your browser reads a node directly; Quantum Fork never relays the traffic. Use your own node’s gateway on this machine, or a listed https RPC.</p>
      <form
        className="nodes-rpc"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid) setRpc(draft.trim())
        }}
      >
        <input className={`acct-input ${draft && !valid ? 'is-bad' : ''}`} value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} aria-label="Node RPC URL" />
        <button type="submit" className="btn btn-secondary" disabled={!valid}>
          Connect
        </button>
        {rpc && (
          <button type="button" className="btn btn-quiet" onClick={() => setRpc(null)}>
            Disconnect
          </button>
        )}
      </form>
      {draft && !valid && <p className="field-error">Use an https URL, or a gateway on this machine (http://127.0.0.1:port).</p>}
      {rpc && error && <p className="callout is-warn">{error} Start one with the commands below, or pick a listed RPC.</p>}
      {wrongChain && (
        <p className="callout is-warn">
          That RPC serves chain {live.chainId}, not this network ({expected}).
        </p>
      )}
      {live && !wrongChain && (
        <>
          <dl className="nodes-live">
            <div>
              <dt>Block</dt>
              <dd>{live.block.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Peers</dt>
              <dd>{live.peers ?? '—'}</dd>
            </div>
            <div>
              <dt>Validators</dt>
              <dd>{live.validators?.length ?? '—'}</dd>
            </div>
            <div>
              <dt>Tolerates</dt>
              <dd>{live.validators ? `${faultTolerance(live.validators.length)} faulty` : '—'}</dd>
            </div>
          </dl>
          {live.validators && (
            <ul className="nodes-validators">
              {live.validators.map((address) => (
                <li key={address}>
                  <code>{getAddress(address)}</code>
                  <span className="muted">{labels.get(address.toLowerCase()) ?? 'not listed'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="nc-fineprint">Read from {rpc} at {new Date(live.at).toLocaleTimeString()}. A shared gateway answers reads and signed transactions only.</p>
        </>
      )}
    </ConsoleSection>
  )
}

/* ---------- listing ---------- */

function decodeListing(hash: string): { listing: NodeListing; nodeSignature: Hex } | null {
  const raw = /(?:^|[#&])list=([A-Za-z0-9_-]+)/.exec(hash)?.[1]
  if (!raw) return null
  try {
    const json = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    const parsed = JSON.parse(json) as { listing?: NodeListing; nodeSignature?: Hex }
    if (!parsed.listing || typeof parsed.nodeSignature !== 'string' || !isAddress(parsed.listing.operator)) return null
    return { listing: parsed.listing, nodeSignature: parsed.nodeSignature }
  } catch {
    return null
  }
}

function PendingListing({ pending, onDone }: { pending: { listing: NodeListing; nodeSignature: Hex }; onDone: () => void }) {
  const evm = useEvmWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { listing } = pending
  const problem = validateListing(listing, now())
  const operator = getAddress(listing.operator)
  const isOperator = Boolean(evm.address && isAddressEqual(evm.address, operator))
  const enode = listing.enode ? parseEnode(listing.enode) : null

  const sign = async () => {
    if (!evm.address) return
    setBusy(true)
    setError(null)
    try {
      const signature = await personalSign(evm.address, listingMessage(listing))
      await api('/api/nodes', { method: 'POST', body: { action: 'list', listing, signature, nodeSignature: pending.nodeSignature } })
      toast('Node listed.')
      onDone()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConsoleSection code="00" title="List this node" className="is-wide nodes-pending" id="list">
      <dl className="acct-kv nodes-kv">
        <div>
          <dt>Role</dt>
          <dd>{listing.role}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{enode ? <code>{enode.host}:{enode.port}</code> : '—'}</dd>
        </div>
        <div>
          <dt>RPC</dt>
          <dd>{listing.rpcUrl ? <code>{listing.rpcUrl}</code> : 'none'}</dd>
        </div>
        <div>
          <dt>Operator</dt>
          <dd>
            <code>{operator}</code>
          </dd>
        </div>
      </dl>
      {problem ? (
        <p className="callout is-warn">{problem} Run init again for a fresh link.</p>
      ) : !evm.address ? (
        <>
          <p className="muted">Connect {shortAddress(operator)} to sign the listing. Signing is free and sends nothing on-chain.</p>
          <BaseWalletPanel />
        </>
      ) : !isOperator ? (
        <p className="callout is-warn">The connected wallet is {shortAddress(evm.address)}. This listing names {shortAddress(operator)} as its operator; connect that wallet instead.</p>
      ) : (
        <div className="nc-inline-actions">
          <button type="button" className="btn btn-primary" onClick={() => void sign()} disabled={busy}>
            {busy ? 'Waiting for the wallet…' : 'Sign and list'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onDone}>
            Dismiss
          </button>
        </div>
      )}
      {error && <p className="callout is-danger">{error}</p>}
      <p className="nc-fineprint">The node key already signed this listing on the operator’s machine, so a node can only be listed by whoever runs it.</p>
    </ConsoleSection>
  )
}

function RpcListingForm({ descendant, onDone }: { descendant: string; onDone: () => void }) {
  const evm = useEvmWallet()
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!evm.address) return null
  const valid = isPublicRpcUrl(url.trim())
  const list = async () => {
    setBusy(true)
    setError(null)
    try {
      const listing: NodeListing = { descendant, role: 'rpc', enode: null, rpcUrl: url.trim(), label: label.trim(), operator: evm.address!, issuedAt: now() }
      const problem = validateListing(listing, now())
      if (problem) throw new Error(problem)
      const signature = await personalSign(evm.address!, listingMessage(listing))
      await api('/api/nodes', { method: 'POST', body: { action: 'list', listing, signature, nodeSignature: null } })
      toast('RPC listed.')
      setUrl('')
      setLabel('')
      onDone()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="nodes-rpc-form">
      <summary>List an https RPC you run</summary>
      <div className="acct-form-grid">
        <label className="acct-field">
          <span>RPC URL</span>
          <input className={`acct-input ${url && !valid ? 'is-bad' : ''}`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://rpc.example.org" spellCheck={false} />
        </label>
        <label className="acct-field">
          <span>Label</span>
          <input className="acct-input" value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} placeholder="optional" />
        </label>
      </div>
      <button type="button" className="btn btn-secondary btn-sm" disabled={!valid || busy} onClick={() => void list()}>
        {busy ? 'Waiting for the wallet…' : `Sign as ${shortAddress(evm.address)} and list`}
      </button>
      {error && <p className="callout is-danger">{error}</p>}
    </details>
  )
}

function DirectoryTable({ directory, pickRpc, refresh }: { directory: Directory; pickRpc: (url: string) => void; refresh: () => void }) {
  const evm = useEvmWallet()
  const [busy, setBusy] = useState<string | null>(null)
  const sealed = new Set(directory.network?.spec.validators.map((address) => address.toLowerCase()) ?? [])
  const remove = async (node: DirectoryNode) => {
    if (!evm.address) return
    setBusy(node.id)
    try {
      const issuedAt = now()
      const signature = await personalSign(evm.address, removalMessage(directory.descendant.id, evm.address, node.id, issuedAt))
      await api('/api/nodes', { method: 'POST', body: { action: 'remove', descendant: directory.descendant.id, node: node.id, operator: evm.address, issuedAt, signature } })
      toast('Listing removed.')
      refresh()
    } catch (caught) {
      toast(errorText(caught))
    } finally {
      setBusy(null)
    }
  }
  if (!directory.nodes.length) return <EmptyState title="No nodes listed yet">Operators list their machines with the node kit below. Listings are signed by the operator’s wallet and by the node’s own key.</EmptyState>
  return (
    <div className="nc-table" role="table" aria-label="Listed nodes">
      <div className="nc-row nc-row-head nodes-row" role="row">
        <span role="columnheader">Node</span>
        <span role="columnheader">Role</span>
        <span role="columnheader">Reach it at</span>
        <span role="columnheader">Operator</span>
        <span role="columnheader">Listed until</span>
        <span role="columnheader" />
      </div>
      {directory.nodes.map((node) => {
        const enode = node.listing.enode ? parseEnode(node.listing.enode) : null
        const mine = Boolean(evm.address && isAddressEqual(evm.address, node.listing.operator))
        return (
          <div key={node.id} className="nc-row nodes-row" role="row">
            <span role="cell">
              <b>{node.listing.label || 'Unnamed'}</b>
              <code>{node.id.startsWith('rpc:') ? node.id.slice(4) : getAddress(node.id)}</code>
            </span>
            <span role="cell" className="nc-status">
              {node.listing.role}
              {sealed.has(node.id) ? ' · genesis' : ''}
            </span>
            <span role="cell">
              {enode && <code>{enode.host}:{enode.port}</code>}
              {node.listing.rpcUrl && <code>{node.listing.rpcUrl}</code>}
            </span>
            <span role="cell">
              <code>{shortAddress(node.listing.operator, 6, 4)}</code>
            </span>
            <span role="cell">
              <small className="muted">{timestamp(new Date(node.expiresAt * 1000).toISOString()).slice(0, 10)}</small>
            </span>
            <span role="cell" className="nodes-actions">
              {node.listing.rpcUrl && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => pickRpc(node.listing.rpcUrl!)}>
                  Use
                </button>
              )}
              {mine && (
                <button type="button" className="btn btn-quiet btn-sm" disabled={busy === node.id} onClick={() => void remove(node)}>
                  {busy === node.id ? 'Signing…' : 'Remove'}
                </button>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- genesis ---------- */

function SealGenesis({ directory, onDone }: { directory: Directory; onDone: () => void }) {
  const evm = useEvmWallet()
  const validators = directory.nodes.filter((node) => node.listing.role === 'validator')
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(validators.slice(0, MAX_GENESIS_VALIDATORS).map((node) => node.id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const owner = directory.descendant.owner!
  const isOwner = Boolean(evm.address && isAddressEqual(evm.address, owner))
  const count = chosen.size

  const seal = async () => {
    if (!evm.address) return
    setBusy(true)
    setError(null)
    try {
      const sealedAt = now()
      const picked = validators.filter((node) => chosen.has(node.id)).map((node) => getAddress(node.id))
      const { descendant } = directory
      const spec: SealedSpec = { descendant: descendant.id, networkId: descendant.networkId, name: descendant.name, params: descendant.params, validators: picked, alloc: ownerAlloc(owner), owner, sealedAt }
      const signature = await personalSign(evm.address, sealMessage(spec))
      await api('/api/nodes', { method: 'POST', body: { action: 'seal', descendant: descendant.id, validators: picked, sealedAt, signature } })
      toast('Genesis sealed.')
      onDone()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!isOwner) {
    return (
      <p className="muted">
        The wallet that registered this descendant (<code>{shortAddress(owner, 6, 4)}</code>) picks the first validators from the listed ones and seals the genesis. {evm.address ? 'The connected wallet is not that wallet.' : 'Connect it to seal.'}
      </p>
    )
  }
  if (!validators.length) return <p className="muted">No validators are listed yet. Once operators list their nodes, pick the first validators here.</p>
  return (
    <div className="nodes-seal">
      <ul className="nodes-pick">
        {validators.map((node) => (
          <li key={node.id}>
            <label>
              <input
                type="checkbox"
                checked={chosen.has(node.id)}
                onChange={(event) => {
                  const next = new Set(chosen)
                  if (event.target.checked) next.add(node.id)
                  else next.delete(node.id)
                  setChosen(next)
                }}
              />
              <b>{node.listing.label || 'Unnamed'}</b> <code>{getAddress(node.id)}</code>
            </label>
          </li>
        ))}
      </ul>
      <p className="muted">
        {count} validator{count === 1 ? '' : 's'}: blocks need {quorum(count)} signatures, and the network keeps going with up to {faultTolerance(count)} down.
        {count > 0 && count < 4 && ' Four or more validators are needed to survive one failure.'}
      </p>
      <p className="callout is-warn">Sealing is permanent: the genesis cannot change afterwards. Validators added later join by vote of the existing ones. The genesis funds only your wallet, with 1,000,000 of the network’s native coin.</p>
      <button type="button" className="btn btn-primary" disabled={!count || count > MAX_GENESIS_VALIDATORS || busy} onClick={() => void seal()}>
        {busy ? 'Waiting for the wallet…' : `Sign and seal the genesis with ${count}`}
      </button>
      {error && <p className="callout is-danger">{error}</p>}
    </div>
  )
}

/* ---------- the tab ---------- */

export function Nodes({ view }: TabProps) {
  const { data: directory, error, refresh } = useNodeDirectory(view.id)
  const evm = useEvmWallet()
  const { query } = useLocation()
  const [pending, setPending] = useState(() => (typeof window === 'undefined' ? null : decodeListing(window.location.hash)))
  const initialRpc = useMemo(() => {
    const fromLink = /(?:^|[#&])rpc=([^&]+)/.exec(typeof window === 'undefined' ? '' : window.location.hash)?.[1] ?? query.get('rpc')
    const candidate = fromLink ? decodeURIComponent(fromLink) : (window.localStorage.getItem(RPC_STORAGE) ?? null)
    return candidate && usableRpc(candidate) ? candidate : null
  }, [query])
  const [rpc, setRpcState] = useState<string | null>(initialRpc)
  const setRpc = useCallback((url: string | null) => {
    setRpcState(url)
    if (url) window.localStorage.setItem(RPC_STORAGE, url)
    else window.localStorage.removeItem(RPC_STORAGE)
  }, [])

  const clearPending = () => {
    setPending(null)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    refresh()
  }

  const id = view.id
  const operator = evm.address ?? '0xYourWallet'
  const header = (
    <header className="nc-tab-head">
      <div>
        <h2>Nodes</h2>
        <p className="section-lede">Run this descendant as a real network on machines people run themselves: Hyperledger Besu with QBFT consensus. Quantum Fork lists nodes and their signed genesis; it never runs or relays them.</p>
      </div>
    </header>
  )

  if (error && !directory) {
    return (
      <>
        {header}
        <p className="callout is-warn">{error}</p>
      </>
    )
  }
  if (!directory) return header
  if (!directory.descendant.eligible) {
    return (
      <>
        {header}
        <EmptyState title="Not available for this descendant">Only EVM descendants registered on Base run as a network here. This one was registered on {view.chain === 'base' ? 'Base, from a Solana ancestor' : 'Solana'}.</EmptyState>
      </>
    )
  }

  const { params } = directory.descendant
  const sealed = directory.network
  const genesisUrl = `/api/nodes?descendant=${encodeURIComponent(id)}&genesis=1`

  return (
    <>
      {header}

      {pending && <PendingListing pending={pending} onDone={clearPending} />}

      <div className="nc-grid">
        <ConsoleSection code="01" title="Network" className="is-wide" aside={sealed ? <span className="nc-tag">GENESIS SEALED</span> : <span className="nc-tag is-off">NOT SEALED</span>}>
          <dl className="nodes-live">
            <div>
              <dt>Chain id</dt>
              <dd>{params.chainId}</dd>
            </div>
            <div>
              <dt>Block time</dt>
              <dd>{params.blockPeriodSeconds}s</dd>
            </div>
            <div>
              <dt>Consensus</dt>
              <dd>QBFT</dd>
            </div>
            <div>
              <dt>Genesis validators</dt>
              <dd>{sealed ? `${sealed.spec.validators.length} · tolerates ${faultTolerance(sealed.spec.validators.length)}` : '—'}</dd>
            </div>
          </dl>
          {sealed ? (
            <>
              <p className="muted">
                Sealed {timestamp(new Date(sealed.spec.sealedAt * 1000).toISOString())} by the registering wallet. Genesis hash <code>{sealed.genesisHash.slice(0, 18)}…</code>. Every node re-derives this file and checks the owner’s signature before starting.
              </p>
              <div className="nc-inline-actions">
                <a className="btn btn-secondary btn-sm" href={genesisUrl} download>
                  <Download size={13} strokeWidth={1.8} /> genesis.json
                </a>
              </div>
            </>
          ) : (
            <SealGenesis directory={directory} onDone={refresh} />
          )}
          <p className="nc-fineprint">
            The running chain is a standard EVM chain: validator, peer and transaction keys are classical secp256k1. The post-quantum modules in this descendant’s genome are not part of it. Besu {BESU_VERSION}, gas limit {params.gasLimit.toLocaleString()}.
          </p>
        </ConsoleSection>

        <LiveNetwork directory={directory} rpc={rpc} setRpc={setRpc} />

        <ConsoleSection code="03" title="Run a node" className="is-wide" id="run">
          <p className="muted">From the open-source repository. Validators need Java 25 (Besu installs itself, checked against its published SHA-256) and an open TCP and UDP port, 30303 by default.</p>
          <ol className="nc-quick">
            <li>
              <p>
                <code>01</code> <b>Get the kit</b> <span className="muted">Node 20 or newer.</span>
              </p>
              <Command text={`git clone ${REPO} && cd quantum-fork && npm install`} />
            </li>
            <li>
              <p>
                <code>02</code> <b>Try it alone</b> <span className="muted">A one-node chain with this network’s chain id on your machine, through anvil. No consensus; for building against.</span>
              </p>
              <Command text={`npm run node -- dev ${id}`} />
            </li>
            <li>
              <p>
                <code>03</code> <b>List your machine</b> <span className="muted">Creates the node key and prints a link; open it and sign with your wallet.</span>
              </p>
              <Command text={`npm run node -- init ${id} --operator ${operator} --host <public IP or domain>`} />
            </li>
            <li>
              <p>
                <code>04</code> <b>Start</b> <span className="muted">{sealed ? 'Runs Besu from the sealed genesis and connects to the listed peers.' : 'Once the owner seals the genesis.'} Add --share to serve read-only RPC to others.</span>
              </p>
              <Command text={`npm run node -- start ${id} --host <public IP or domain>`} />
            </li>
            <li>
              <p>
                <code>05</code> <b>Add a validator later</b> <span className="muted">Each validator votes from its own machine; it joins once more than half agree.</span>
              </p>
              <Command text={`npm run node -- vote ${id} add <node address>`} />
            </li>
          </ol>
        </ConsoleSection>

        <ConsoleSection
          code="04"
          title="Directory"
          className="is-wide"
          id="directory"
          aside={
            <button type="button" className="icon-btn" aria-label="Refresh the directory" onClick={refresh}>
              <RefreshCw size={14} strokeWidth={1.8} />
            </button>
          }
        >
          <DirectoryTable directory={directory} pickRpc={(url) => (setRpc(url), document.getElementById('live')?.scrollIntoView({ behavior: 'smooth' }))} refresh={refresh} />
          <RpcListingForm descendant={id} onDone={refresh} />
          <p className="nc-fineprint">Listings last 30 days and are signed by the operator’s wallet; node listings are also signed by the node key. Only public addresses and https RPCs are listed. Quantum Fork does not check uptime or vouch for operators.</p>
        </ConsoleSection>
      </div>
    </>
  )
}
