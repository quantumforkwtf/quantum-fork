import { z } from 'zod'
import { base58Decode, base58Encode } from './address.js'
import { PUMP_PROGRAM_ID } from './pumpfun.js'
import { MEMO_PROGRAM, MEMO_PROGRAM_V1, type ParsedTx, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from './verifyBurn.js'

/**
 * Tokens launched for a registered descendant. Two real paths:
 *  - SPL: a classic SPL token with Metaplex metadata, created from the
 *    owner's wallet on the site's cluster (devnet today).
 *  - Pump.fun: a bonding-curve token created through PumpPortal on mainnet.
 * The server records a token only after reading its creation transaction and
 * mint account from the chain; nothing the client reports is trusted.
 */

export type TokenKind = 'spl' | 'pumpfun' | 'clanker'
export type TokenCluster = 'devnet' | 'testnet' | 'mainnet-beta' | 'base' | 'base-sepolia'

export const SPL_MINT_SIZE = 82
export const PUMP_DECIMALS = 6
export const PUMP_TOTAL_SUPPLY_RAW = 1_000_000_000n * 10n ** 6n
/** Rough upper bounds, shown before signing. The wallet's own fee preview is authoritative. */
export const SPL_COST_HINT_SOL = 0.02
export const PUMP_COST_HINT_SOL = 0.025

const name = z.string().trim().min(1, 'Name is required').max(32, 'Name fits 32 characters')
const symbol = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{2,10}$/, 'Symbol is 2–10 capital letters or digits')
const description = z.string().trim().max(280, 'Description fits 280 characters')

export const tokenSpecSchema = z.object({ name, symbol, description })

/** Clanker fixes supply (100B) and decimals (18); only the identity is chosen. */
export const clankerSpecSchema = tokenSpecSchema
export type ClankerSpec = z.infer<typeof clankerSpecSchema>

export const splSpecSchema = tokenSpecSchema.extend({
  decimals: z.number().int().min(0).max(9),
  /** Whole tokens. */
  supply: z.string().regex(/^[1-9][0-9]{0,15}$/, 'Supply is a whole number up to 16 digits'),
  fixedSupply: z.boolean(),
})

export const pumpSpecSchema = tokenSpecSchema.extend({
  /** SOL spent on the creator's first buy, in the same transaction. */
  devBuySol: z.number().min(0).max(5),
})

export type TokenSpec = z.infer<typeof tokenSpecSchema>
export type SplSpec = z.infer<typeof splSpecSchema>
export type PumpSpec = z.infer<typeof pumpSpecSchema>

export function supplyRaw(spec: Pick<SplSpec, 'supply' | 'decimals'>) {
  const raw = BigInt(spec.supply) * 10n ** BigInt(spec.decimals)
  if (raw > 0xffff_ffff_ffff_ffffn) throw new Error('Supply × 10^decimals exceeds the SPL maximum.')
  return raw
}

export function tokenMemo(deploymentId: string) {
  return `qfork:v1:token:${deploymentId}`
}

/** Mint seed for SPL tokens created with createAccountWithSeed: short, unique, public. */
export function tokenSeed(random: () => string) {
  return `qf${random().slice(0, 18)}`
}

/** The JSON a token's metadata URI serves, in the Metaplex fungible standard. */
export interface TokenMetadataJson {
  name: string
  symbol: string
  description: string
  image: string
  external_url: string
  attributes: { trait_type: string; value: string }[]
}

export interface TokenRecord {
  mint: string
  kind: TokenKind
  cluster: TokenCluster
  deploymentId: string
  descendantId: string
  name: string
  symbol: string
  decimals: number
  supplyRaw: string
  /** Null once mint authority is revoked: the supply can never grow. */
  mintAuthority: string | null
  tokenProgram: string
  uri: string | null
  creator: string
  signature: string
  slot: number
  createdAt: string
  verifiedAt: string
}

/** A Clanker deployToken transaction the server built for one owner. The token address is only known once it lands. */
export interface PreparedClanker {
  launchId: string
  kind: 'clanker'
  cluster: 'base' | 'base-sepolia'
  chainId: number
  deploymentId: string
  descendantId: string
  wallet: string
  spec: ClankerSpec
  to: string
  data: string
  image: string
  pairedToken: string
  rewardRecipient: string
  createdAt: string
}

export interface PreparedLaunch {
  mint: string
  kind: TokenKind
  cluster: TokenCluster
  deploymentId: string
  descendantId: string
  wallet: string
  seed: string | null
  metadata: TokenMetadataJson
  uri: string
  createdAt: string
}

/* ---------- on-chain verification ---------- */

export type TokenVerification = { ok: true; creator: string; slot: number; blockTime: number | null } | { ok: false; code: TokenErrorCode; message: string }

export type TokenErrorCode = 'TX_FAILED' | 'WRONG_PAYER' | 'NO_MINT_CREATED' | 'WRONG_AUTHORITY' | 'MEMO_MISMATCH' | 'NOT_PUMP' | 'MINT_NOT_SIGNER'

const fail = (code: TokenErrorCode, message: string): TokenVerification => ({ ok: false, code, message })

type Parsed = { programId: string; program?: string; parsed: unknown }
const isParsed = (ix: ParsedTx['transaction']['message']['instructions'][number]): ix is Parsed => 'parsed' in ix

function feePayer(tx: ParsedTx) {
  const first = tx.transaction.message.accountKeys[0]
  return first?.signer ? first.pubkey : null
}

function memos(tx: ParsedTx) {
  return tx.transaction.message.instructions.filter((ix) => (ix.programId === MEMO_PROGRAM || ix.programId === MEMO_PROGRAM_V1) && isParsed(ix)).map((ix) => String((ix as Parsed).parsed))
}

/** An SPL token created by `owner` for `deploymentId`: owner paid, the mint was initialized in this transaction with owner as mint authority, and the memo binds it. */
export function verifySplCreation(tx: ParsedTx, expect: { mint: string; owner: string; memo: string }): TokenVerification {
  if (tx.meta?.err) return fail('TX_FAILED', 'The transaction failed on-chain.')
  if (feePayer(tx) !== expect.owner) return fail('WRONG_PAYER', 'The token was not created by the descendant’s owner wallet.')
  const init = tx.transaction.message.instructions.find((ix) => {
    if (!isParsed(ix) || (ix.programId !== TOKEN_PROGRAM && ix.programId !== TOKEN_2022_PROGRAM)) return false
    const parsed = ix.parsed as { type?: string; info?: { mint?: string } }
    return (parsed.type === 'initializeMint2' || parsed.type === 'initializeMint') && parsed.info?.mint === expect.mint
  }) as Parsed | undefined
  if (!init) return fail('NO_MINT_CREATED', 'This transaction did not create the token mint.')
  const authority = (init.parsed as { info: { mintAuthority?: string } }).info.mintAuthority
  if (authority !== expect.owner) return fail('WRONG_AUTHORITY', 'The mint authority is not the owner wallet.')
  if (!memos(tx).includes(expect.memo)) return fail('MEMO_MISMATCH', 'The transaction is not bound to this descendant.')
  return { ok: true, creator: expect.owner, slot: tx.slot, blockTime: tx.blockTime ?? null }
}

/** A Pump.fun token created by `owner`: owner paid, the mint signed (it was a fresh keypair), and the Pump program ran. */
export function verifyPumpCreation(tx: ParsedTx, expect: { mint: string; owner: string }): TokenVerification {
  if (tx.meta?.err) return fail('TX_FAILED', 'The transaction failed on-chain.')
  if (feePayer(tx) !== expect.owner) return fail('WRONG_PAYER', 'The token was not created by the descendant’s owner wallet.')
  const keys = tx.transaction.message.accountKeys
  if (!keys.some((key) => key.pubkey === expect.mint && key.signer)) return fail('MINT_NOT_SIGNER', 'The mint did not sign, so it was not created in this transaction.')
  if (!tx.transaction.message.instructions.some((ix) => ix.programId === PUMP_PROGRAM_ID)) return fail('NOT_PUMP', 'This transaction did not call the Pump.fun program.')
  return { ok: true, creator: expect.owner, slot: tx.slot, blockTime: tx.blockTime ?? null }
}

/* ---------- Metaplex metadata account ---------- */

/** Reads name, symbol and URI from a Metaplex metadata account (key, update authority, mint, then borsh strings). */
export function decodeMetadataAccount(data: Uint8Array): { mint: string; name: string; symbol: string; uri: string } | null {
  if (data.length < 1 + 32 + 32 + 12 || data[0] !== 4) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const mint = base58Encode(data.slice(33, 65))
  let offset = 65
  const read = () => {
    if (offset + 4 > data.length) return null
    const length = view.getUint32(offset, true)
    offset += 4
    if (offset + length > data.length) return null
    const value = new TextDecoder().decode(data.slice(offset, offset + length)).replace(/\0+$/, '')
    offset += length
    return value
  }
  const tokenName = read()
  const tokenSymbol = read()
  const uri = read()
  if (tokenName === null || tokenSymbol === null || uri === null) return null
  return { mint, name: tokenName.trim(), symbol: tokenSymbol.trim(), uri: uri.trim() }
}

/* ---------- signing a prepared transaction with an extra keypair ---------- */

function shortVec(bytes: Uint8Array, offset: number) {
  let value = 0
  let shift = 0
  let position = offset
  for (;;) {
    const byte = bytes[position]
    position += 1
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, next: position }
    shift += 7
  }
}

/** Index of `signer` among a wire transaction's required signers, for legacy and v0 messages. */
export function signerIndex(transaction: Uint8Array, signer: string): number {
  const signatures = shortVec(transaction, 0)
  let offset = signatures.next + signatures.value * 64
  if (transaction[offset] & 0x80) offset += 1
  const required = transaction[offset]
  const keys = shortVec(transaction, offset + 3)
  const target = base58Decode(signer)
  for (let index = 0; index < Math.min(required, keys.value); index += 1) {
    const start = keys.next + index * 32
    if (target.every((byte, position) => transaction[start + position] === byte)) return index
  }
  return -1
}

/** Writes a 64-byte signature into a signer's slot. */
export function withSignature(transaction: Uint8Array, index: number, signature: Uint8Array): Uint8Array {
  const { next } = shortVec(transaction, 0)
  const out = transaction.slice()
  out.set(signature, next + index * 64)
  return out
}
