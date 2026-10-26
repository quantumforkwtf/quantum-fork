import { getAddress, type Hex, hexToBigInt, isAddress, keccak256, toHex, toRlp, zeroHash } from 'viem'
import type { DescendantConfig } from './descendant.js'

/**
 * Descendant networks run as ordinary EVM chains: Hyperledger Besu with QBFT, a Byzantine fault
 * tolerant consensus where a fixed set of validators take turns proposing blocks and more than two
 * thirds must sign each one. Validator keys, peer keys and transactions are classical secp256k1. The
 * post-quantum modules in a descendant's genome are not part of the running chain.
 */
export const NETWORK_FORMAT = 'qfork.network.v1'
export const LISTING_TTL_SECONDS = 30 * 24 * 3600
export const SIGNATURE_WINDOW_SECONDS = 15 * 60
export const MAX_NODES_PER_DESCENDANT = 64
export const MAX_NODES_PER_OPERATOR = 4
export const MAX_GENESIS_VALIDATORS = 32
export const BESU_VERSION = '26.10.2'
/** A registered descendant's id: its deployment id. */
export const DESCENDANT_ID = /^dep_[a-z0-9]{16,32}$/

/** QBFT's genesis mixHash, fixed by the protocol ("istanbul byzantine fault tolerance"). */
const QBFT_MIX_HASH = '0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365'
/** Chain ids are derived into this range so descendants do not collide with each other or with public chains. */
const CHAIN_ID_BASE = 1_900_000_000
const CHAIN_ID_SPAN = 100_000_000

export interface NetworkParams {
  chainId: number
  blockPeriodSeconds: number
  epochLength: number
  requestTimeoutSeconds: number
  gasLimit: number
}

export function descendantChainId(networkId: string): number {
  return CHAIN_ID_BASE + Number(hexToBigInt(keccak256(toHex(`qfork.chain-id.v1:${networkId}`))) % BigInt(CHAIN_ID_SPAN))
}

/** Only EVM descendants can run as a Besu network; Solana descendants have no node here. */
export function canRunNetwork(config: DescendantConfig) {
  return config.ancestor === 'base'
}

export function networkParams(config: DescendantConfig): NetworkParams {
  return {
    chainId: descendantChainId(config.network.networkId),
    blockPeriodSeconds: config.validators.hardware === 'high' ? 1 : 2,
    epochLength: 30_000,
    requestTimeoutSeconds: config.validators.hardware === 'high' ? 4 : 6,
    gasLimit: 30_000_000,
  }
}

/** Faults a validator set of `n` survives while still finalizing blocks: n = 3f + 1. */
export const faultTolerance = (validators: number) => Math.max(0, Math.floor((validators - 1) / 3))

/** Commit signatures a QBFT block needs: ceil(2n / 3), as Besu computes it. */
export const quorum = (validators: number) => Math.ceil((2 * validators) / 3)

/** RLP([32-byte vanity, validators, no vote, round 0, no seals]), as Besu's QBFT_EXTRA_DATA encoder writes it. */
export function qbftExtraData(validators: Hex[]): Hex {
  return toRlp([zeroHash, validators.map((validator) => getAddress(validator).toLowerCase() as Hex), [], '0x', []])
}

export interface SealedSpec {
  descendant: string
  networkId: string
  name: string
  params: NetworkParams
  validators: Hex[]
  /** Address → balance in wei, as a decimal string. */
  alloc: Record<string, string>
  owner: Hex
  /** Unix seconds; also the genesis timestamp. */
  sealedAt: number
}

/** The only premine: the descendant's owner, who can then fund others. 1,000,000 units of the native coin. */
export const OWNER_PREMINE_WEI = 10n ** 24n
export const ownerAlloc = (owner: Hex): Record<string, string> => ({ [getAddress(owner)]: OWNER_PREMINE_WEI.toString() })

/** The Besu genesis file every node of the network must use byte-for-byte. */
export function besuGenesis(spec: SealedSpec) {
  return {
    config: {
      chainId: spec.params.chainId,
      berlinBlock: 0,
      londonBlock: 0,
      shanghaiTime: 0,
      qbft: { blockperiodseconds: spec.params.blockPeriodSeconds, epochlength: spec.params.epochLength, requesttimeoutseconds: spec.params.requestTimeoutSeconds },
    },
    nonce: '0x0',
    timestamp: toHex(spec.sealedAt),
    gasLimit: toHex(spec.params.gasLimit),
    difficulty: '0x1',
    mixHash: QBFT_MIX_HASH,
    coinbase: '0x0000000000000000000000000000000000000000',
    alloc: Object.fromEntries(Object.entries(spec.alloc).map(([address, balance]) => [getAddress(address).toLowerCase(), { balance: toHex(BigInt(balance)) }])),
    extraData: qbftExtraData(spec.validators),
  }
}

export function genesisJson(spec: SealedSpec): string {
  return `${JSON.stringify(besuGenesis(spec), null, 2)}\n`
}

export const genesisDigest = (spec: SealedSpec) => keccak256(toHex(genesisJson(spec)))

/* ---------- enodes ---------- */

const ENODE = /^enode:\/\/([0-9a-f]{128})@([a-zA-Z0-9.-]{1,253}|\[[0-9a-fA-F:]{2,39}\]):(\d{1,5})$/

export function parseEnode(enode: string): { publicKey: Hex; host: string; port: number } | null {
  const match = ENODE.exec(enode.trim())
  if (!match) return null
  const port = Number(match[3])
  if (port < 1 || port > 65535) return null
  return { publicKey: `0x${match[1]}`, host: match[2], port }
}

/** The address of the key behind an enode: the last 20 bytes of keccak256(uncompressed public key). */
export function enodeAddress(enode: string): Hex | null {
  const parsed = parseEnode(enode)
  return parsed ? getAddress(`0x${keccak256(parsed.publicKey).slice(-40)}`) : null
}

/** An uncompressed secp256k1 public key (0x04…) as an enode URL. */
export function enodeOf(publicKey: Hex, host: string, port: number): string {
  const raw = publicKey.startsWith('0x04') && publicKey.length === 132 ? publicKey.slice(4) : publicKey.slice(2)
  return `enode://${raw.toLowerCase()}@${host}:${port}`
}

/** Hosts a public directory may list: no loopback, private, link-local, carrier-grade NAT or reserved ranges. */
export function isPublicHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (!name || name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.internal')) return false
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (v4.slice(1).some((part) => Number(part) > 255)) return false
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)))
  }
  if (name.includes(':')) return !(name === '::' || name === '::1' || /^(fc|fd|fe8|fe9|fea|feb)/.test(name) || name.startsWith('::ffff:'))
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(name)
}

export function isPublicRpcUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && isPublicHost(parsed.hostname) && url.length <= 200
  } catch {
    return false
  }
}

/* ---------- signed listings ---------- */

export type NodeRole = 'validator' | 'rpc'

export interface NodeListing {
  descendant: string
  role: NodeRole
  /** Required for validators; the node key behind it must also sign the listing. */
  enode: string | null
  /** A public https endpoint others may use. Optional for validators. */
  rpcUrl: string | null
  label: string
  operator: Hex
  /** Unix seconds. */
  issuedAt: number
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z')

/** What the operator's wallet (and, for an enode, the node key) signs with personal_sign. */
export function listingMessage(listing: NodeListing): string {
  return [
    'Quantum Fork · list a node',
    `Descendant: ${listing.descendant}`,
    `Role: ${listing.role}`,
    `Enode: ${listing.enode ?? 'none'}`,
    `RPC: ${listing.rpcUrl ?? 'none'}`,
    `Label: ${listing.label || 'none'}`,
    `Operator: ${getAddress(listing.operator)}`,
    `Issued: ${iso(listing.issuedAt)}`,
  ].join('\n')
}

export function removalMessage(descendant: string, operator: Hex, nodeId: string, issuedAt: number): string {
  return ['Quantum Fork · remove a node', `Descendant: ${descendant}`, `Node: ${nodeId}`, `Operator: ${getAddress(operator)}`, `Issued: ${iso(issuedAt)}`].join('\n')
}

export function sealMessage(spec: SealedSpec): string {
  return [
    'Quantum Fork · seal a network genesis',
    `Descendant: ${spec.descendant}`,
    `Network: ${spec.networkId}`,
    `Chain id: ${spec.params.chainId}`,
    `Validators: ${spec.validators.map((validator) => getAddress(validator)).join(', ')}`,
    `Genesis: ${genesisDigest(spec)}`,
    `Owner: ${getAddress(spec.owner)}`,
    `Issued: ${iso(spec.sealedAt)}`,
  ].join('\n')
}

/** A stable id for a listing: its node key address, or its RPC host for RPC-only listings. */
export function nodeId(listing: Pick<NodeListing, 'enode' | 'rpcUrl'>): string {
  if (listing.enode) return enodeAddress(listing.enode)!.toLowerCase()
  return `rpc:${new URL(listing.rpcUrl!).host.toLowerCase()}`
}

/** Checks a listing's own fields. Signatures are checked separately. */
export function validateListing(listing: NodeListing, nowSeconds: number): string | null {
  if (!DESCENDANT_ID.test(listing.descendant)) return 'Unknown descendant.'
  if (listing.role !== 'validator' && listing.role !== 'rpc') return 'Role must be validator or rpc.'
  if (!isAddress(listing.operator)) return 'Operator must be an address.'
  if (!Number.isSafeInteger(listing.issuedAt) || Math.abs(nowSeconds - listing.issuedAt) > SIGNATURE_WINDOW_SECONDS) return 'The signature has expired. Sign the listing again.'
  if (typeof listing.label !== 'string' || listing.label.length > 40 || /[\n\r]/.test(listing.label)) return 'Use a label of at most 40 characters.'
  if (listing.enode !== null) {
    const parsed = parseEnode(listing.enode)
    if (!parsed) return 'That is not an enode URL (enode://<128 hex>@host:port).'
    if (!isPublicHost(parsed.host)) return 'The enode host must be a public address or domain, not a private or local one.'
  }
  if (listing.role === 'validator' && !listing.enode) return 'A validator listing needs its enode.'
  if (listing.rpcUrl !== null && !isPublicRpcUrl(listing.rpcUrl)) return 'The RPC must be a public https URL.'
  if (listing.role === 'rpc' && !listing.rpcUrl) return 'An RPC listing needs its https URL.'
  return null
}

/* ---------- RPC gateway policy ---------- */

/** The only methods a shared node answers. No account, admin, debug, txpool, miner or devnet methods. */
export const GATEWAY_METHODS = new Set([
  'web3_clientVersion',
  'net_version',
  'net_listening',
  'net_peerCount',
  'eth_chainId',
  'eth_syncing',
  'eth_blockNumber',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionCount',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getBlockTransactionCountByNumber',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getLogs',
  'eth_call',
  'eth_estimateGas',
  'eth_sendRawTransaction',
  'qbft_getValidatorsByBlockNumber',
  'qbft_getValidatorsByBlockHash',
])
export const GATEWAY_MAX_BATCH = 20
export const GATEWAY_MAX_LOG_RANGE = 1_000n

/** Returns why a JSON-RPC call is refused, or null if the gateway may forward it. */
export function gatewayRefusal(call: { method?: unknown; params?: unknown }): string | null {
  if (typeof call.method !== 'string' || !GATEWAY_METHODS.has(call.method)) return `Method ${String(call.method)} is not available on a shared node.`
  if (call.method === 'eth_getLogs') {
    const filter = (Array.isArray(call.params) ? call.params[0] : null) as { fromBlock?: unknown; toBlock?: unknown; blockHash?: unknown } | null
    if (!filter || typeof filter !== 'object') return 'eth_getLogs needs a filter.'
    if (filter.blockHash !== undefined) return null
    const block = (value: unknown) => (typeof value === 'string' && /^0x[0-9a-f]{1,16}$/i.test(value) ? BigInt(value) : null)
    const from = block(filter.fromBlock)
    const to = block(filter.toBlock)
    if (from === null || to === null) return 'eth_getLogs needs numeric fromBlock and toBlock on a shared node.'
    if (to < from || to - from > GATEWAY_MAX_LOG_RANGE) return `eth_getLogs ranges are limited to ${GATEWAY_MAX_LOG_RANGE} blocks.`
  }
  return null
}
