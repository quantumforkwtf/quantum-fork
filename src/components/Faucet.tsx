import { Droplets } from 'lucide-react'
import { useState } from 'react'
import { CLIENT_CONFIG, explorerTx, useServerStatus } from '../config'
import { FlowError } from '../lib/failures'
import { formatNumber } from '../lib/hooks'
import { claimFaucet } from '../lib/solana/launch'
import { refreshBalances, useWallet } from '../lib/solana/wallet'
import { toast } from '../lib/toast'
import FailurePanel from './FailurePanel'

/** Devnet only: test QFORK for the burn, from the server-held devnet mint authority. */
export function FaucetPanel({ need }: { need: number }) {
  const server = useServerStatus()
  const wallet = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<FlowError | null>(null)
  const [last, setLast] = useState<string | null>(null)

  if (CLIENT_CONFIG.network === 'mainnet-beta' || server.state !== 'ok') return null
  const faucet = server.status.faucet
  const balances = wallet.balances
  const held = balances?.qforkRaw != null && balances.qforkDecimals != null ? Number(balances.qforkRaw) / 10 ** balances.qforkDecimals : null
  const sol = balances?.lamports != null ? Number(balances.lamports) / 1e9 : null
  const short = held === null || held < need

  const claim = async () => {
    if (!wallet.address) return
    setBusy(true)
    setError(null)
    try {
      const result = await claimFaucet(wallet.address)
      setLast(result.signature)
      await refreshBalances()
      toast(`${formatNumber(result.amount)} test QFORK${result.solTopUp ? ` and ${result.solTopUp} devnet SOL` : ''} sent.`)
    } catch (caught) {
      setError(caught instanceof FlowError ? caught : new FlowError('FAUCET_FAILED'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="faucet">
      <p className="mono-label">Devnet test tokens</p>
      <p className="muted">
        This wallet holds <b>{held === null ? '…' : formatNumber(Math.floor(held))} test QFORK</b> and <b>{sol === null ? '…' : sol.toLocaleString('en-US', { maximumFractionDigits: 4 })} devnet SOL</b>. The burn needs {formatNumber(need)}. Test
        tokens have no value.
      </p>
      {faucet.available ? (
        <button type="button" className={`btn ${short ? 'btn-primary' : 'btn-secondary'} btn-sm`} disabled={busy || !wallet.address} onClick={() => void claim()}>
          <Droplets size={14} strokeWidth={1.8} /> {busy ? 'Sending…' : `Get ${formatNumber(faucet.amount)} test QFORK`}
        </button>
      ) : (
        <p className="field-error">{faucet.reason}</p>
      )}
      {last && (
        <p className="muted">
          <a href={explorerTx(last)} target="_blank" rel="noreferrer">
            Faucet transaction →
          </a>
        </p>
      )}
      {error && <FailurePanel error={error} />}
    </div>
  )
}
