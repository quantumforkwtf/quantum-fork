import { LogOut, RefreshCw, Wallet, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { encodeFunctionData, erc20Abi, type Hex } from 'viem'
import { useServerStatus } from '../config'
import { shortAddress } from '../protocol/address'
import { formatBaseUnits } from '../protocol/pricing'
import { clearEvmError, connectEvm, disconnectEvm, evmProvider, useEvmWallet } from '../lib/evm/wallet'
import FailurePanel from './FailurePanel'

/** EIP-6963 wallet picker for Base. Shows the connected account, or every wallet the browser announced. */
export function BaseWalletPanel() {
  const evm = useEvmWallet()
  if (evm.status === 'connected' && evm.address) {
    return (
      <div className="wallet-summary">
        <p className="mono-label">Connected · {evm.wallets.find((wallet) => wallet.uuid === evm.walletId)?.name ?? 'Wallet'}</p>
        <p>
          <code>{shortAddress(evm.address, 6, 6)}</code>
        </p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={disconnectEvm}>
          Disconnect
        </button>
      </div>
    )
  }
  return (
    <div className="wallet-list">
      {evm.wallets.length === 0 && <p className="muted">No Ethereum wallet was detected in this browser. Install Coinbase Wallet, MetaMask or Rabby, then reload.</p>}
      {evm.wallets.map((wallet) => (
        <button key={wallet.uuid} type="button" className="btn btn-secondary" disabled={evm.status === 'connecting'} onClick={() => void connectEvm(wallet.uuid)}>
          {wallet.icon && <img src={wallet.icon} alt="" width={18} height={18} />} {wallet.name}
        </button>
      ))}
      {evm.error && <FailurePanel error={evm.error} />}
    </div>
  )
}

/** Connect sheet for the nav. Never asks for keys or seed phrases. */
function BaseWalletSheet({ onClose }: { onClose: () => void }) {
  const evm = useEvmWallet()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (evm.status === 'connected') onClose()
  }, [evm.status, onClose])

  return (
    <div className="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} className="sheet" tabIndex={-1}>
        <header className="sheet-head">
          <span className="mono-label">Connect wallet · Base</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.8} />
          </button>
        </header>
        {evm.error && <FailurePanel error={evm.error} actions={<button type="button" className="btn btn-quiet btn-sm" onClick={clearEvmError}>Dismiss</button>} />}
        {evm.wallets.length === 0 ? (
          <div className="sheet-empty">
            <p>No Ethereum wallet was detected in this browser.</p>
            <p className="muted">Install Coinbase Wallet, MetaMask or Rabby, then reload.</p>
          </div>
        ) : (
          <ul className="wallet-list">
            {evm.wallets.map((wallet) => (
              <li key={wallet.uuid}>
                <button type="button" className="wallet-option" disabled={evm.status === 'connecting'} onClick={() => void connectEvm(wallet.uuid)}>
                  {wallet.icon && <img src={wallet.icon} alt="" width={28} height={28} />}
                  <span>
                    <strong>{wallet.name}</strong>
                    <small>{evm.status === 'connecting' && evm.walletId === wallet.uuid ? 'Waiting for approval…' : 'EIP-6963'}</small>
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

/** Whole tokens with at most two decimals, rounded down. */
function shortUnits(raw: bigint, decimals: number) {
  const shown = Math.min(decimals, 2)
  return formatBaseUnits(raw / 10n ** BigInt(decimals - shown), shown)
}

/** QFORK balance, read through the connected wallet once it is on the server's Base network. */
function useQforkBalance(address: Hex | null, chainId: number | null) {
  const server = useServerStatus()
  const base = server.state === 'ok' ? server.status.base : undefined
  const token = base?.tokenStatus === 'LIVE' ? (base.token as Hex | null) : null
  const onBase = Boolean(base && chainId === base.chainId)
  const [balance, setBalance] = useState<{ raw: bigint; decimals: number } | null>(null)
  const refresh = useCallback(async () => {
    if (!address || !token || !onBase) return setBalance(null)
    try {
      const call = (data: Hex) => evmProvider().request({ method: 'eth_call', params: [{ to: token, data }, 'latest'] }) as Promise<Hex>
      const [raw, decimals] = await Promise.all([
        call(encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [address] })),
        call(encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' })),
      ])
      setBalance({ raw: BigInt(raw), decimals: Number(BigInt(decimals)) })
    } catch {
      setBalance(null)
    }
  }, [address, token, onBase])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { live: Boolean(token), onBase, network: base?.network === 'base-sepolia' ? 'Base Sepolia' : 'Base', balance, refresh }
}

export function BaseWalletButton() {
  const evm = useEvmWallet()
  const [open, setOpen] = useState(false)
  const [popped, setPopped] = useState(false)
  const qfork = useQforkBalance(evm.address, evm.chainId)
  const close = useCallback(() => setOpen(false), [])
  if (evm.status === 'connected' && evm.address) {
    return (
      <span className="wallet-anchor">
        <button type="button" className="btn btn-secondary btn-sm wallet-chip" aria-expanded={popped} title={evm.address} onClick={() => setPopped(!popped)}>
          <Wallet size={14} strokeWidth={1.8} aria-hidden="true" />
          <span className="wallet-chip-label">{shortAddress(evm.address)}</span>
        </button>
        {popped && (
          <span className="wallet-pop" role="dialog" aria-label="Wallet">
            <div className="wallet-summary">
              <span className="wallet-dot" aria-hidden="true" />
              <dl>
                <div>
                  <dt>{evm.wallets.find((wallet) => wallet.uuid === evm.walletId)?.name ?? 'Wallet'}</dt>
                  <dd>
                    <code>{shortAddress(evm.address, 6, 6)}</code>
                  </dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>{qfork.onBase ? qfork.network : `Not ${qfork.network}`}</dd>
                </div>
                <div>
                  <dt>QFORK</dt>
                  <dd>{!qfork.live ? 'PRELAUNCH' : qfork.balance ? shortUnits(qfork.balance.raw, qfork.balance.decimals) : '—'}</dd>
                </div>
              </dl>
              <div className="wallet-actions">
                <button type="button" className="icon-btn" onClick={() => void qfork.refresh()} aria-label="Refresh balance" title="Refresh balance">
                  <RefreshCw size={14} strokeWidth={1.8} />
                </button>
                <button type="button" className="icon-btn" onClick={disconnectEvm} aria-label="Disconnect wallet" title="Disconnect">
                  <LogOut size={14} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          </span>
        )}
      </span>
    )
  }
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm wallet-chip" onClick={() => setOpen(true)} disabled={evm.status === 'connecting'}>
        <Wallet size={14} strokeWidth={1.8} aria-hidden="true" />
        <span className="wallet-chip-label">{evm.status === 'connecting' ? 'Connecting' : 'Connect'}</span>
      </button>
      {open && <BaseWalletSheet onClose={close} />}
    </>
  )
}
