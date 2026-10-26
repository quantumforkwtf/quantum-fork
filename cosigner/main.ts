import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { BASE_CHAIN_ID, BASE_PUBLIC_RPC, type BaseNetwork } from '../src/protocol/base.js'
import { DEFAULT_ORIGINS, DEFAULT_PORT, startCosigner } from './server.js'

const { values } = parseArgs({
  options: {
    network: { type: 'string', default: 'base' },
    rpc: { type: 'string' },
    port: { type: 'string', default: String(DEFAULT_PORT) },
    'key-file': { type: 'string', default: join(homedir(), '.qfork-cosigner', 'key.json') },
    origin: { type: 'string', multiple: true },
    help: { type: 'boolean', default: false },
  },
})

if (values.help) {
  console.log(`qfork-cosigner: approves QForkAccount proposals only after checking the account's post-quantum signatures.

  --network base | base-sepolia   default base
  --rpc <url>                     default the public Base endpoint for the network
  --port <n>                      default ${DEFAULT_PORT}, bound to 127.0.0.1 only
  --key-file <path>               default ~/.qfork-cosigner/key.json, created on first run
  --origin <url>                  browser origin allowed to call it (repeatable), default ${DEFAULT_ORIGINS.join(', ')}`)
  process.exit(0)
}

const network = values.network as BaseNetwork
if (!(network in BASE_CHAIN_ID)) {
  console.error(`Unknown network "${values.network}". Use base or base-sepolia.`)
  process.exit(2)
}

const started = await startCosigner({
  network,
  chainId: BASE_CHAIN_ID[network],
  rpcUrl: values.rpc ?? BASE_PUBLIC_RPC[network],
  port: Number(values.port),
  keyFile: values['key-file']!,
  origins: values.origin ?? DEFAULT_ORIGINS,
})

console.log(`qfork-cosigner on ${network} (chain ${BASE_CHAIN_ID[network]}) at ${started.url}`)
console.log(`co-signer address ${started.address}${started.created ? `  (new key saved to ${values['key-file']}; back it up)` : ''}`)
console.log('Add this address as an owner of your account, and fund it with a little ETH for approval gas.')
