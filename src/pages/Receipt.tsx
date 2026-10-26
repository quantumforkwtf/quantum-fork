import { Copy, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Pill } from '../components/Status'
import { explorerAddress, explorerTx, isMainnetNetwork } from '../config'
import { useRegistry } from '../lab/registry'
import { api, ApiError } from '../lib/api'
import { usePageMeta } from '../lib/meta'
import { copyText } from '../lib/toast'
import { isSignature, shortAddress } from '../protocol/address'
import { formatBaseUnits } from '../protocol/pricing'
import type { BurnReceipt } from '../protocol/receipt'
import { Link } from '../router'

type Load = { state: 'loading' } | { state: 'ok'; receipt: BurnReceipt } | { state: 'missing'; message: string } | { state: 'error'; message: string }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export default function Receipt({ id }: { id: string }) {
  const registry = useRegistry()
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  usePageMeta({
    title: `Burn receipt ${shortAddress(id, 6, 6)}`,
    description: 'A server-verified QFORK burn receipt for a registered post-quantum descendant.',
    path: `/burn/${id}`,
    image: `/api/og?burn=${encodeURIComponent(id)}`,
  })

  useEffect(() => {
    if (!isSignature(id)) {
      setLoad({ state: 'missing', message: 'This is not a transaction signature.' })
      return
    }
    let cancelled = false
    api<{ receipt: BurnReceipt }>(`/api/burns?signature=${encodeURIComponent(id)}`)
      .then(({ data }) => !cancelled && setLoad({ state: 'ok', receipt: data.receipt }))
      .catch((error) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 404) setLoad({ state: 'missing', message: error.message })
        else setLoad({ state: 'error', message: error instanceof ApiError ? error.message : 'The receipt service is unreachable.' })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const receipt = load.state === 'ok' ? load.receipt : null
  const verified = receipt?.verificationStatus === 'VERIFIED' && receipt.verifier === 'server'

  if (!receipt) {
    const message = load.state === 'missing' || load.state === 'error' ? load.message : 'Looking up the receipt…'
    return (
      <div className="page-head not-found">
        <p className="eyebrow">Burn receipt</p>
        <h1>{load.state === 'loading' ? 'Verifying…' : 'No receipt.'}</h1>
        <p className="section-lede">{message}</p>
        {isSignature(id) && (
          <a className="btn btn-secondary" href={explorerTx(id)} target="_blank" rel="noreferrer noopener">
            Look up the transaction <ExternalLink size={13} strokeWidth={1.8} />
          </a>
        )}
      </div>
    )
  }

  const network = receipt.network
  const onBase = receipt.chain === 'base'
  const descendant = registry.find((item) => item.receipt?.id === receipt.id || item.deployment?.id === receipt.deploymentId)

  return (
    <div className="receipt-page">
      <article className={`receipt panel ${verified ? 'is-verified' : ''}`} aria-label="Burn receipt">
        <header className="receipt-head">
          <p className="mono-label">QUANTUM FORK · BURN RECEIPT · {receipt.purpose}</p>
          <div className={`receipt-stamp ${verified ? 'is-verified' : ''}`} role="status">
            {verified ? 'BURN VERIFIED' : `BURN ${receipt.verificationStatus}`}
          </div>
          <p className="receipt-amount">
            {formatBaseUnits(receipt.amountRaw, receipt.decimals)} <span>{isMainnetNetwork(network) ? 'QFORK' : 'TEST QFORK'}</span>
          </p>
          <p className="muted">
            {onBase ? 'Sent to the burn address 0x…dEaD' : 'Destroyed with the SPL burn instruction'} on {receipt.network}. Read from the finalized transaction by the server, not reported by a browser. It registered {receipt.descendantId}.
          </p>
        </header>

        <dl className="report receipt-fields">
          <Row label="Descendant">{descendant ? <Link to={`/species/${descendant.id}`}>{receipt.descendantId}</Link> : receipt.descendantId}</Row>
          <Row label="Ancestor">{receipt.ancestor === 'base' ? 'BASE' : 'SOLANA'}</Row>
          <Row label="Network">
            {receipt.network} {!isMainnetNetwork(network) && <Pill label="TEST TOKEN · NO VALUE" tone="var(--cyan)" />}
          </Row>
          <Row label={onBase ? 'Transaction' : 'Signature'}>
            <a href={explorerTx(receipt.signature, network)} target="_blank" rel="noreferrer noopener">
              {shortAddress(receipt.signature, 10, 10)} <ExternalLink size={11} strokeWidth={1.8} />
            </a>
          </Row>
          <Row label="Wallet">
            <a href={explorerAddress(receipt.wallet, network)} target="_blank" rel="noreferrer noopener">
              {shortAddress(receipt.wallet, 6, 6)}
            </a>
          </Row>
          <Row label={onBase ? 'Token' : 'Mint'}>
            <a href={explorerAddress(receipt.mint, network)} target="_blank" rel="noreferrer noopener">
              {shortAddress(receipt.mint, 6, 6)}
            </a>
          </Row>
          <Row label="Base units">
            {receipt.amountRaw} ({receipt.decimals} decimals)
          </Row>
          <Row label={onBase ? 'Block' : 'Slot'}>{receipt.slot?.toLocaleString('en-US') ?? '—'}</Row>
          <Row label="Block time">{receipt.timestamp.replace('T', ' ').slice(0, 19)} UTC</Row>
          <Row label="Verified">{receipt.verifiedAt ? `${receipt.verifiedAt.replace('T', ' ').slice(0, 19)} UTC · finalized` : '—'}</Row>
          {!onBase && <Row label="Token program">{receipt.tokenProgram ? shortAddress(receipt.tokenProgram) : '—'}</Row>}
          <Row label="Deployment">
            <code>{receipt.deploymentId}</code>
          </Row>
        </dl>

        <footer className="receipt-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyText(window.location.href, 'Receipt link copied.')}>
            <Copy size={13} strokeWidth={1.8} /> Copy link
          </button>
          <Link to="/species" className="btn btn-quiet btn-sm">
            Descendant explorer
          </Link>
        </footer>
      </article>
    </div>
  )
}
