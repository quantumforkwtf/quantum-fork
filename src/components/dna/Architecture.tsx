import { type ChainDna, chosenOptions, SUPPORT } from '../../protocol/chainDna'

interface Layer {
  name: string
  operator: string
  detail: string
  tone: 'theirs' | 'yours' | 'missing' | 'local'
}

function layers(dna: ChainDna): Layer[] {
  const contracts = chosenOptions(dna).filter((item) => item.support === 'contracts')
  const yours: Layer = {
    name: 'Your contracts',
    operator: contracts.length ? `${contracts.length} component${contracts.length === 1 ? '' : 's'} you deploy` : 'None required',
    detail: contracts.length ? contracts.map((item) => item.option.label).join(' · ') : 'Everything chosen is built in.',
    tone: 'yours',
  }
  if (dna.target === 'base') {
    return [yours, { name: dna.network.settlement === 'base' ? 'Base · 8453' : 'Base Sepolia · 84532', operator: 'Operated by Base', detail: '2 s blocks · sequencer · fault proofs', tone: 'theirs' }, { name: dna.network.settlement === 'base' ? 'Ethereum' : 'Sepolia', operator: 'Settlement', detail: 'Data and proofs posted here', tone: 'theirs' }]
  }
  if (dna.target === 'local-devnet') {
    const fork = dna.network.fork
    return [
      yours,
      { name: `Anvil · chain ${dna.network.chainId}`, operator: 'Runs on your machine', detail: `${dna.network.blockTimeMs ? `${dna.network.blockTimeMs / 1000} s blocks` : 'mines on every transaction'} · ${(dna.network.gasLimit ?? 0).toLocaleString('en-US')} gas`, tone: 'local' },
      ...(fork ? [{ name: `${fork.source === 'base' ? 'Base' : 'Base Sepolia'} state`, operator: fork.block ? `Forked at block ${fork.block.toLocaleString('en-US')}` : 'Forked at the latest block', detail: 'Read-only source. Nothing is written back.', tone: 'theirs' as const }] : []),
    ]
  }
  return [
    yours,
    { name: `Your rollup · chain ${dna.network.chainId}`, operator: 'You would operate it', detail: 'op-geth · op-node · op-batcher · op-proposer', tone: 'missing' },
    { name: dna.network.settlement === 'base' ? 'Base' : dna.network.settlement === 'base-sepolia' ? 'Base Sepolia' : dna.network.settlement === 'ethereum' ? 'Ethereum' : 'Sepolia', operator: 'Settlement', detail: 'Your batches and output roots post here', tone: 'theirs' },
  ]
}

/** Who runs each layer. Built from the configuration, never decorative. */
export function Architecture({ dna }: { dna: ChainDna }) {
  return (
    <ol className="arch" aria-label="Architecture">
      {layers(dna).map((layer) => (
        <li key={layer.name} className={`arch-layer is-${layer.tone}`}>
          <div>
            <b>{layer.name}</b>
            <span>{layer.operator}</span>
          </div>
          <small>{layer.detail}</small>
        </li>
      ))}
      {dna.target === 'op-stack' && <li className="arch-note">{SUPPORT.infrastructure.meaning} Quantum Fork cannot provision it.</li>}
    </ol>
  )
}
