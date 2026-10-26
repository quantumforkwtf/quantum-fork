import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, getAddress, type Hex, http, isAddressEqual, isHex, recoverMessageAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { BASE_PUBLIC_RPC, type BaseNetwork } from '../src/protocol/base.js'
import { enodeOf, genesisDigest, listingMessage, type NetworkParams, type NodeListing, type SealedSpec, sealMessage } from '../src/protocol/nodes.js'
import { KIT_HOME } from './besu.js'

export const DEFAULT_SITE = 'https://quantumfork.wtf'

export interface DirectoryNode {
  id: string
  listing: NodeListing
  signature: Hex
  nodeSignature: Hex | null
  expiresAt: number
}

export interface Directory {
  descendant: { id: string; name: string; networkId: string; ancestor: string; chain: string; network?: string | null; owner: Hex | null; eligible: boolean; params: NetworkParams }
  network: { spec: SealedSpec; signature: Hex; genesisHash: Hex } | null
  nodes: DirectoryNode[]
}

export const networkDir = (descendant: string, home = KIT_HOME) => join(home, 'networks', descendant)

/** The node key, in Besu's key file format. Created on first use; readable by its owner only. */
export function loadOrCreateNodeKey(dir: string) {
  const file = join(dir, 'key')
  let privateKey: Hex
  let created = false
  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf8').trim()
    const value = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex
    if (!isHex(value) || value.length !== 66) throw new Error(`${file} is not a node key.`)
    privateKey = value
  } else {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    privateKey = generatePrivateKey()
    writeFileSync(file, privateKey, { mode: 0o600, flag: 'wx' })
    chmodSync(file, 0o600)
    created = true
  }
  const account = privateKeyToAccount(privateKey)
  return { file, account, address: account.address, publicKey: account.publicKey, created }
}

export async function fetchDirectory(site: string, descendant: string): Promise<Directory> {
  const response = await fetch(`${site.replace(/\/$/, '')}/api/nodes?descendant=${encodeURIComponent(descendant)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  const body = (await response.json().catch(() => null)) as (Directory & { error?: { message?: string } }) | null
  if (!response.ok || !body?.descendant) throw new Error(body?.error?.message ?? `${site} answered ${response.status}.`)
  return body
}

/**
 * Re-derives the genesis from the sealed spec and checks the owner's signature over it, so a node
 * never runs a genesis the descendant's owner did not sign, whatever the server says.
 */
export async function verifySeal(directory: Directory): Promise<string | null> {
  const network = directory.network
  if (!network) return 'This network’s genesis is not sealed yet. Its owner seals it on the descendant’s Nodes page.'
  const { spec } = network
  if (!directory.descendant.owner || !isAddressEqual(spec.owner, directory.descendant.owner)) return 'The sealed genesis names a different owner than the descendant.'
  if (spec.descendant !== directory.descendant.id) return 'The sealed genesis is for another descendant.'
  if (genesisDigest(spec) !== network.genesisHash) return 'The genesis does not match its recorded hash.'
  const message = sealMessage(spec)
  try {
    if (isAddressEqual(await recoverMessageAddress({ message, signature: network.signature }), spec.owner)) return null
  } catch {
    // Not a plain ECDSA signature; ask the owner's wallet contract on Base.
  }
  const chain = (directory.descendant.network === 'base-sepolia' ? 'base-sepolia' : 'base') as BaseNetwork
  const valid = await createPublicClient({ transport: http(BASE_PUBLIC_RPC[chain]) })
    .verifyMessage({ address: spec.owner, message, signature: network.signature })
    .catch(() => false)
  return valid ? null : 'The owner’s signature over this genesis does not verify.'
}

/** Signs a listing with the node key, proving whoever lists it controls the node. */
export async function signListing(key: ReturnType<typeof loadOrCreateNodeKey>, listing: NodeListing) {
  return key.account.signMessage({ message: listingMessage(listing) })
}

export function listingLink(site: string, listing: NodeListing, nodeSignature: Hex) {
  const payload = Buffer.from(JSON.stringify({ listing, nodeSignature })).toString('base64url')
  return `${site.replace(/\/$/, '')}/network/${listing.descendant}/nodes#list=${payload}`
}

export const enodeFor = (key: ReturnType<typeof loadOrCreateNodeKey>, host: string, port: number) => enodeOf(key.publicKey, host, port)

export async function rpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10_000) })
  const body = (await response.json()) as { result?: T; error?: { message: string } }
  if (body.error) throw new Error(body.error.message)
  return body.result as T
}

export const checksum = (address: string) => getAddress(address)
