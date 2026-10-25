import { shortAddress } from '../protocol/address'
import { connectEvm, disconnectEvm, useEvmWallet } from '../lib/evm/wallet'
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
