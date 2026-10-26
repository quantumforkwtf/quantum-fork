import { Copy, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ConsoleSection } from '../../components/network/Parts'
import { downloadFile, networkHref, type TabProps } from '../../lib/networkUi'
import { Link } from '../../router'
import { copyText } from '../../lib/toast'
import { explorerAddress } from '../../config'
import { assertNoSecrets, devKitFiles, kitNetwork, kitRpc, quickstart } from '../../protocol/devKit'

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

export function Developers({ view }: TabProps) {
  const kit = view.devKit
  const files = useMemo(() => assertNoSecrets(devKitFiles(kit), kit.burnSignature ? [kit.burnSignature] : []), [kit])
  const [shown, setShown] = useState(files[0].name)
  const base = kit.chain === 'base'
  const network = kitNetwork(kit)
  const file = files.find((item) => item.name === shown) ?? files[0]

  const rows: { label: string; value: React.ReactNode; status: string }[] = [
    { label: base ? 'Base RPC' : 'Solana RPC', value: <code>{kitRpc(kit)}</code>, status: network === 'mainnet-beta' || network === 'base' ? 'MAINNET' : network.toUpperCase() },
    ...kit.tokens.map((token) => ({
      label: `$${token.symbol}`,
      value: (
        <a href={explorerAddress(token.mint, token.cluster)} target="_blank" rel="noreferrer">
          <code>{token.mint}</code>
        </a>
      ),
      status: token.kind === 'clanker' ? 'CLANKER ERC-20' : token.kind === 'pumpfun' ? 'PUMP.FUN MINT' : 'SPL MINT',
    })),
    { label: 'Descendant id', value: <code>{view.config.network.networkId}</code>, status: 'REGISTERED' },
    { label: 'Manifest', value: 'descendant.json, below', status: 'GENERATED' },
    { label: 'SDK', value: `${base ? 'viem' : '@solana/web3.js'}, configured by qfork.config.ts.`, status: 'STANDARD TOOLING' },
    view.config.ancestor === 'base' && base
      ? { label: 'Descendant RPC', value: <Link to={networkHref(view.id, 'nodes')}>Run a node, or use one an operator lists →</Link>, status: 'OPERATOR-RUN' }
      : { label: 'Descendant RPC', value: <span className="muted">Only EVM descendants registered on Base run as a network.</span>, status: 'NOT BUILT' },
  ]

  return (
    <>
      <header className="nc-tab-head">
        <div>
          <h2>Developers</h2>
          <p className="section-lede">Everything a developer needs to build against this descendant’s tokens, as public configuration. No private keys, seed phrases or credentials are ever generated here.</p>
        </div>
        <div className="nc-inline-actions">
          <button type="button" className="btn btn-primary" onClick={() => files.forEach((item) => downloadFile(item.name, item.contents, item.type))}>
            <Download size={15} strokeWidth={1.8} /> Download config
          </button>
        </div>
      </header>

      <ConsoleSection code="01" title="Addresses and tooling" className="is-wide">
        <div className="nc-table" role="table">
          {rows.map((row) => (
            <div key={row.label} className="nc-row nc-endpoints" role="row">
              <span role="rowheader" className="mono-label">
                {row.label}
              </span>
              <span role="cell">{row.value}</span>
              <span role="cell" className={`nc-status ${row.status === 'NOT BUILT' ? 'is-off' : ''}`}>
                {row.status}
              </span>
            </div>
          ))}
        </div>
      </ConsoleSection>

      <ConsoleSection code="02" title="Quickstart" className="is-wide">
        <p className="muted">{base ? 'Standard Foundry cast commands' : 'Standard Solana CLI commands'} against {network}. They work today{kit.tokens.length ? '' : `; launch a token to fill in its ${base ? 'address' : 'mint'}`}.</p>
        <ol className="nc-quick">
          {quickstart(kit).map((step, index) => (
            <li key={step.id}>
              <p>
                <code>{String(index + 1).padStart(2, '0')}</code> <b>{step.title}</b> <span className="muted">{step.detail}</span>
              </p>
              {step.commands.map((command) => (
                <Command key={command} text={command} />
              ))}
            </li>
          ))}
        </ol>
      </ConsoleSection>

      <ConsoleSection code="03" title="Developer kit" className="is-wide">
        <div className="nc-files" role="tablist" aria-label="Files">
          {files.map((item) => (
            <button key={item.name} type="button" role="tab" aria-selected={item.name === file.name} className={item.name === file.name ? 'is-on' : ''} onClick={() => setShown(item.name)}>
              {item.name}
            </button>
          ))}
        </div>
        <pre className="nc-file" role="tabpanel" aria-label={file.name}>
          <code>{file.contents}</code>
        </pre>
        <div className="nc-inline-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyText(file.contents, `${file.name} copied.`)}>
            <Copy size={13} strokeWidth={1.8} /> Copy
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => downloadFile(file.name, file.contents, file.type)}>
            <Download size={13} strokeWidth={1.8} /> Download {file.name}
          </button>
        </div>
        <p className="nc-fineprint">Built from the descendant’s records: each verified token appears here with its real address.</p>
      </ConsoleSection>
    </>
  )
}
