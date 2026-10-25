import { decodeEventLog, encodeAbiParameters, encodeFunctionData, getAddress, type Hex, keccak256, parseAbi } from 'viem'
import type { EvmReceipt, EvmTx } from './base.js'

/** contracts/src/QForkRegistry.sol */
export const REGISTRY_ABI = parseAbi([
  'function register(bytes32 configHash, uint8 kind, string metadataURI) returns (bytes32)',
  'function registerVersion(bytes32 parent, bytes32 configHash, uint8 kind, string metadataURI) returns (bytes32)',
  'function updateMetadata(bytes32 id, string metadataURI)',
  'function exists(bytes32 id) view returns (bool)',
  'function recordId(address creator, bytes32 configHash) pure returns (bytes32)',
  'function get(bytes32 id) view returns ((address creator, uint64 registeredAt, uint32 version, uint8 kind, bytes32 configHash, bytes32 parent, string metadataURI))',
  'event Registered(bytes32 indexed id, address indexed creator, bytes32 indexed configHash, uint8 kind, uint32 version, bytes32 parent, string metadataURI)',
  'event MetadataUpdated(bytes32 indexed id, string metadataURI)',
  'error ZeroConfigHash()',
  'error AlreadyRegistered(bytes32 id)',
  'error UnknownRecord(bytes32 id)',
  'error NotCreator(bytes32 id, address caller)',
  'error URITooLong(uint256 length)',
])

export const REGISTRY_MAX_URI_BYTES = 512

export function registryRecordId(creator: Hex, configHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [getAddress(creator), configHash]))
}

export function registerCalldata(configHash: Hex, kind: number, metadataURI: string): Hex {
  return encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'register', args: [configHash, kind, metadataURI] })
}

export interface RegistryExpectation {
  registry: Hex
  chainId: number
  configHash: Hex
  kind: number
}

export interface RegistryAnchor {
  recordId: Hex
  creator: Hex
  configHash: Hex
  kind: number
  version: number
  parent: Hex
  metadataURI: string
  blockNumber: bigint
}

export type RegistryVerification = ({ ok: true } & RegistryAnchor) | { ok: false; code: string; message: string }

const fail = (code: string, message: string): RegistryVerification => ({ ok: false, code, message })
const same = (a: string | null | undefined, b: string) => Boolean(a) && a!.toLowerCase() === b.toLowerCase()

/**
 * Reads a registration from a transaction the server fetched itself. Anyone may anchor a
 * configuration; what must hold is that the registry emitted Registered for this exact hash.
 */
export function verifyRegistration(tx: EvmTx | null, receipt: EvmReceipt | null, expected: RegistryExpectation): RegistryVerification {
  if (!tx || !receipt) return fail('TX_NOT_FOUND', 'The transaction is not on Base yet.')
  if (receipt.status !== 'success') return fail('TX_FAILED', 'The transaction reverted. Nothing was registered.')
  if (tx.chainId !== undefined && tx.chainId !== expected.chainId) return fail('WRONG_CHAIN', 'The transaction was sent on a different chain.')
  if (!same(tx.to, expected.registry)) return fail('WRONG_CONTRACT', 'The transaction did not call the Quantum Fork registry.')
  const events = []
  for (const log of receipt.logs) {
    if (!same(log.address, expected.registry)) continue
    try {
      const event = decodeEventLog({ abi: REGISTRY_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
      if (event.eventName === 'Registered' && same(event.args.configHash, expected.configHash)) events.push(event.args)
    } catch {
      // Not a registry event.
    }
  }
  if (events.length !== 1) return fail('NOT_REGISTERED', 'The registry did not record this configuration hash in that transaction.')
  const event = events[0]
  if (!same(event.creator, tx.from)) return fail('WRONG_SENDER', 'The record names a different creator than the sender.')
  if (event.kind !== expected.kind) return fail('KIND_MISMATCH', 'The record’s deployment type does not match the configuration’s target.')
  return {
    ok: true,
    recordId: event.id,
    creator: getAddress(event.creator),
    configHash: event.configHash,
    kind: event.kind,
    version: event.version,
    parent: event.parent,
    metadataURI: event.metadataURI,
    blockNumber: receipt.blockNumber,
  }
}
