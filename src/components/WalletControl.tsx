import { LogOut, RefreshCw, Wallet, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CLIENT_CONFIG } from '../config'
import { shortAddress } from '../protocol/address'
import { formatBaseUnits } from '../protocol/pricing'
import { clearWalletError, connect, disconnect, refreshBalances, useWallet } from '../lib/solana/wallet'
import FailurePanel from './FailurePanel'

function formatSol(lamports: bigint | null) {
  return lamports === null ? '—' : formatBaseUnits(lamports, 9)
}

/** Connect sheet: lists Wallet Standard wallets. Never asks for keys or seed phrases. */
export function WalletSheet({ onClose }: { onClose: () => void }) {
  const wallet = useWallet()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (wallet.status === 'connected') onClose()
  }, [wallet.status, onClose])

  return (
    <div className="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} className="sheet" tabIndex={-1}>
        <header className="sheet-head">
          <span className="mono-label">Connect wallet · {CLIENT_CONFIG.network}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.8} />
          </button>
        </header>
        {wallet.error && <FailurePanel error={wallet.error} actions={<button type="button" className="btn btn-quiet btn-sm" onClick={clearWalletError}>Dismiss</button>} />}
        {!wallet.ready ? (
          <p className="muted">Looking for wallets…</p>
        ) : wallet.options.length === 0 ? (
          <div className="sheet-empty">
            <p>No Solana wallet was detected in this browser.</p>
            <p className="muted">Install a Wallet Standard wallet such as Phantom, Solflare or Backpack, then reload.</p>
          </div>
        ) : (
          <ul className="wallet-list">
            {wallet.options.map((option) => (
              <li key={option.name}>
                <button type="button" className="wallet-option" disabled={wallet.status === 'connecting' || !option.supportsChain} onClick={() => void connect(option.name)}>
                  <img src={option.icon} alt="" width={28} height={28} />
                  <span>
                    <strong>{option.name}</strong>
                    <small>{option.supportsChain ? (wallet.status === 'connecting' ? 'Waiting for approval…' : 'Wallet Standard') : `Does not support ${CLIENT_CONFIG.network}`}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="sheet-note">Quantum Fork never asks for a private key or seed phrase. Signing happens inside your wallet, and every transaction is shown to you before it is signed.</p>
      </div>
    </div>
  )
}

export function WalletSummary() {
  const wallet = useWallet()
  if (wallet.status !== 'connected' || !wallet.address) return null
  const qfork = wallet.balances?.qforkRaw ?? null
  const decimals = wallet.balances?.qforkDecimals ?? 6
  return (
    <div className="wallet-summary">
      <span className="wallet-dot" aria-hidden="true" />
      <dl>
        <div>
          <dt>{wallet.walletName}</dt>
          <dd>
            <code>{shortAddress(wallet.address, 6, 6)}</code>
          </dd>
        </div>
        <div>
          <dt>SOL</dt>
          <dd>{formatSol(wallet.balances?.lamports ?? null)}</dd>
        </div>
        <div>
          <dt>QFORK</dt>
          <dd>{CLIENT_CONFIG.tokenStatus !== 'LIVE' ? 'PRELAUNCH' : qfork === null ? '—' : formatBaseUnits(qfork, decimals)}</dd>
        </div>
      </dl>
      <div className="wallet-actions">
        <button type="button" className="icon-btn" onClick={() => void refreshBalances()} aria-label="Refresh balances" title="Refresh balances">
          <RefreshCw size={14} strokeWidth={1.8} />
        </button>
        <button type="button" className="icon-btn" onClick={() => void disconnect()} aria-label="Disconnect wallet" title="Disconnect">
          <LogOut size={14} strokeWidth={1.8} />
        </button>
      </div>
      {wallet.balances?.error && <p className="field-error">{wallet.balances.error}</p>}
    </div>
  )
}

export function WalletButton() {
  const wallet = useWallet()
  const [open, setOpen] = useState(false)
  if (wallet.status === 'connected' && wallet.address) {
    return (
      <span className="wallet-anchor">
        <button type="button" className="btn btn-secondary btn-sm wallet-chip" aria-expanded={open} title={wallet.address} onClick={() => setOpen(!open)}>
          <Wallet size={14} strokeWidth={1.8} aria-hidden="true" />
          <span className="wallet-chip-label">{shortAddress(wallet.address)}</span>
        </button>
        {open && (
          <span className="wallet-pop" role="dialog" aria-label="Wallet">
            <WalletSummary />
          </span>
        )}
      </span>
    )
  }
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm wallet-chip" onClick={() => setOpen(true)} disabled={wallet.status === 'connecting'}>
        <Wallet size={14} strokeWidth={1.8} aria-hidden="true" />
        <span className="wallet-chip-label">{wallet.status === 'connecting' ? 'Connecting' : 'Connect'}</span>
      </button>
      {open && <WalletSheet onClose={() => setOpen(false)} />}
    </>
  )
}
