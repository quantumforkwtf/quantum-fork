import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { getAddress, type Hex, isAddress } from 'viem'
import { faultTolerance, genesisJson, type NodeListing, parseEnode, validateListing } from '../src/protocol/nodes.js'
import { checkJava, findBesu, installBesu, resolveEnodes, startBesu } from './besu.js'
import { startGateway } from './gateway.js'
import { DEFAULT_SITE, enodeFor, fetchDirectory, listingLink, loadOrCreateNodeKey, networkDir, rpc, signListing, verifySeal } from './kit.js'

const HELP = `qfork-node: run a Quantum Fork descendant network on your machine.

  npm run node -- dev <descendant>        single-node local chain (anvil), no consensus
  npm run node -- init <descendant> --operator 0x… --host <public ip or domain>
                                          create this machine's node key and a listing link to sign
  npm run node -- start <descendant>      run a QBFT validator or peer from the sealed genesis (Besu)
  npm run node -- vote <descendant> add|remove <validator address>
  npm run node -- status <descendant>
  npm run node -- install-besu            download Besu and check its SHA-256

  --site <url>        default ${DEFAULT_SITE}
  --rpc-port <n>      shared RPC gateway port, default 8545
  --share             let other machines use the gateway (binds 0.0.0.0); it only answers standard read
                      methods and signed transactions
  --p2p-port <n>      peer port, default 30303 (others must be able to reach it)
  --host <host>       the public IP or domain peers reach this machine at
  --role validator|rpc, --rpc-url <https url>, --label <text>   for init`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    site: { type: 'string', default: DEFAULT_SITE },
    'rpc-port': { type: 'string', default: '8545' },
    'p2p-port': { type: 'string', default: '30303' },
    host: { type: 'string' },
    share: { type: 'boolean', default: false },
    operator: { type: 'string' },
    role: { type: 'string', default: 'validator' },
    'rpc-url': { type: 'string' },
    label: { type: 'string', default: '' },
    help: { type: 'boolean', default: false },
  },
})

const [command, descendant, ...rest] = positionals
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
if (values.help || !command) {
  console.log(HELP)
  process.exit(0)
}
const site = values.site!
const rpcPort = Number(values['rpc-port'])
const p2pPort = Number(values['p2p-port'])
const internalPort = rpcPort + 10_000

async function directory() {
  if (!descendant) fail('Name the descendant: its id from the Quantum Fork descendant console.')
  const found = await fetchDirectory(site, descendant).catch((error: Error) => fail(`Could not read the descendant from ${site}: ${error.message}`))
  if (!found.descendant.eligible) fail('Only EVM descendants registered on Base can run a network.')
  return found
}

async function share(chainId: number, upstream: string) {
  const gateway = await startGateway({ upstream, host: values.share ? '0.0.0.0' : '127.0.0.1', port: rpcPort, chainId })
  console.log(`RPC gateway ${gateway.url}${values.share ? ` (shared on port ${rpcPort} of this machine)` : ' (this machine only; add --share to let others use it)'}`)
  console.log(`Watch it in the browser: ${site}/network/${descendant}/nodes#rpc=${encodeURIComponent(gateway.url)}`)
  if (values.share) {
    const shared = `http://${values.host ?? '<this machine>'}:${rpcPort}`
    console.log(`Others can point wallets, cast or viem at ${shared}.`)
    console.log(`Browsers need https: put the gateway behind a TLS proxy and list that URL (init --role rpc --rpc-url https://…), then share ${site}/network/${descendant}/nodes#rpc=https://…`)
  }
  return gateway
}

async function dev() {
  const { descendant: info } = await directory()
  if (spawnSync('anvil', ['--version']).status !== 0) fail('The dev chain needs Foundry’s anvil: curl -L https://foundry.paradigm.xyz | bash && foundryup')
  const { chainId, blockPeriodSeconds, gasLimit } = info.params
  const node = spawn('anvil', ['--chain-id', String(chainId), '--block-time', String(blockPeriodSeconds), '--gas-limit', String(gasLimit), '--host', '127.0.0.1', '--port', String(internalPort), '--silent'], { stdio: 'inherit' })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await rpc(`http://127.0.0.1:${internalPort}`, 'eth_chainId').then(() => true, () => false)) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  console.log(`${info.name} dev chain: chain id ${chainId}, a block every ${blockPeriodSeconds}s. One node, no consensus; anvil's public test accounts are funded.`)
  await share(chainId, `http://127.0.0.1:${internalPort}`)
  process.on('SIGINT', () => (node.kill(), process.exit(0)))
}

async function init() {
  const { descendant: info } = await directory()
  if (!values.operator || !isAddress(values.operator)) fail('Pass --operator with the wallet address you will sign the listing with.')
  if (!values.host) fail('Pass --host with the public IP address or domain other nodes reach this machine at.')
  const key = loadOrCreateNodeKey(networkDir(info.id))
  const role = values.role === 'rpc' ? 'rpc' : 'validator'
  const listing: NodeListing = {
    descendant: info.id,
    role,
    enode: enodeFor(key, values.host!, p2pPort),
    rpcUrl: values['rpc-url'] ?? null,
    label: values.label ?? '',
    operator: getAddress(values.operator!),
    issuedAt: Math.floor(Date.now() / 1000),
  }
  const problem = validateListing(listing, listing.issuedAt)
  if (problem) fail(problem)
  const link = listingLink(site, listing, await signListing(key, listing))
  console.log(`${key.created ? 'Created' : 'Using'} the node key in ${key.file} (owner-only). Keep it; it is this node's identity.`)
  console.log(`Node address ${key.address}`)
  console.log(`Enode ${listing.enode}`)
  console.log(`\nOpen this link within 15 minutes and sign with ${listing.operator} to list the node:\n${link}`)
}

async function start() {
  const found = await directory()
  const problem = await verifySeal(found)
  if (problem) fail(problem)
  const { spec } = found.network!
  const dir = networkDir(spec.descendant)
  const key = loadOrCreateNodeKey(dir)
  let besu = findBesu()
  if (!besu) besu = await installBesu()
  const javaProblem = checkJava(besu)
  if (javaProblem) fail(javaProblem)
  const genesisFile = join(dir, 'genesis.json')
  writeFileSync(genesisFile, genesisJson(spec))
  const peers = found.nodes.filter((node) => node.listing.enode && node.id !== key.address.toLowerCase())
  const bootnodes = await resolveEnodes(peers.map((node) => node.listing.enode!))
  const validator = spec.validators.some((address) => address.toLowerCase() === key.address.toLowerCase())
  console.log(`${spec.name}: chain id ${spec.params.chainId}, ${spec.validators.length} genesis validators (tolerates ${faultTolerance(spec.validators.length)} faulty).`)
  console.log(validator ? `This node (${key.address}) is a genesis validator.` : `This node (${key.address}) is not in the genesis validator set. It syncs as a peer until validators vote it in: npm run node -- vote ${spec.descendant} add ${key.address}`)
  const own = found.nodes.find((node) => node.id === key.address.toLowerCase())?.listing.enode
  const host = values.host ?? (own ? parseEnode(own)?.host : undefined) ?? '127.0.0.1'
  const [self] = await resolveEnodes([enodeFor(key, host, p2pPort)])
  const p2pHost = (self && parseEnode(self)?.host) || host
  const node = startBesu({ besu, dataDir: join(dir, 'data'), genesisFile, keyFile: key.file, p2pPort, p2pHost, rpcPort: internalPort, bootnodes, logFile: join(dir, 'besu.log') })
  node.on('exit', (code) => fail(`Besu stopped (${code}). See ${join(dir, 'besu.log')}.`))
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await rpc(`http://127.0.0.1:${internalPort}`, 'eth_chainId').then(() => true, () => false)) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  await share(spec.params.chainId, `http://127.0.0.1:${internalPort}`)
  process.on('SIGINT', () => (node.kill('SIGTERM'), process.exit(0)))
  setInterval(async () => {
    const [block, peers] = await Promise.all([rpc<Hex>(`http://127.0.0.1:${internalPort}`, 'eth_blockNumber'), rpc<Hex>(`http://127.0.0.1:${internalPort}`, 'net_peerCount')]).catch(() => [null, null])
    if (block) console.log(`block ${Number(block)} · ${Number(peers)} peers`)
  }, 15_000)
}

async function vote() {
  const [direction, address] = rest
  if ((direction !== 'add' && direction !== 'remove') || !address || !isAddress(address)) fail('Usage: npm run node -- vote <descendant> add|remove <validator address>')
  const ok = await rpc<boolean>(`http://127.0.0.1:${internalPort}`, 'qbft_proposeValidatorVote', [getAddress(address), direction === 'add']).catch((error: Error) => fail(`Could not reach this machine's node (${error.message}). Run start first.`))
  console.log(ok ? `Voted to ${direction} ${getAddress(address)}. It takes effect once more than half of the validators have voted the same way.` : 'The node did not accept the vote.')
}

async function status() {
  const url = `http://127.0.0.1:${internalPort}`
  const [chainId, block, peers, validators] = await Promise.all([rpc<Hex>(url, 'eth_chainId'), rpc<Hex>(url, 'eth_blockNumber'), rpc<Hex>(url, 'net_peerCount'), rpc<Hex[]>(url, 'qbft_getValidatorsByBlockNumber', ['latest'])]).catch((error: Error) => fail(`Could not reach this machine's node (${error.message}). Run start first.`))
  console.log(`chain ${Number(chainId)} · block ${Number(block)} · ${Number(peers)} peers`)
  console.log(`validators (${validators.length}, tolerates ${faultTolerance(validators.length)} faulty):\n  ${validators.join('\n  ')}`)
}

const commands: Record<string, () => Promise<unknown>> = { dev, init, start, vote, status, 'install-besu': () => installBesu() }
if (!commands[command]) fail(HELP)
await commands[command]()
