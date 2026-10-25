import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha2'

export type PublicKeyLike = string

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function base58Decode(value: string): Uint8Array {
  let number = 0n
  for (const char of value) {
    const digit = ALPHABET.indexOf(char)
    if (digit < 0) throw new Error('Invalid base58 character')
    number = number * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (number > 0n) {
    bytes.unshift(Number(number % 256n))
    number /= 256n
  }
  for (const char of value) {
    if (char !== '1') break
    bytes.unshift(0)
  }
  return Uint8Array.from(bytes)
}

export function base58Encode(bytes: Uint8Array): string {
  let number = 0n
  for (const byte of bytes) number = number * 256n + BigInt(byte)
  let out = ''
  while (number > 0n) {
    out = ALPHABET[Number(number % 58n)] + out
    number /= 58n
  }
  for (const byte of bytes) {
    if (byte !== 0) break
    out = `1${out}`
  }
  return out
}

/** A base58 string that decodes to exactly 32 bytes. */
export function isBase58Address(value: string) {
  if (!BASE58.test(value)) return false
  try {
    return base58Decode(value).length === 32
  } catch {
    return false
  }
}

export function shortAddress(value: string, head = 4, tail = 4) {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`
}

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/

export function isSignature(value: string) {
  if (!SIGNATURE.test(value)) return false
  try {
    return base58Decode(value).length === 64
  } catch {
    return false
  }
}

function isOnCurve(bytes: Uint8Array) {
  try {
    ed25519.ExtendedPoint.fromHex(bytes)
    return true
  } catch {
    return false
  }
}

/** Solana program-derived address: the first bump (255 → 0) whose hash is off the ed25519 curve. */
export function findProgramAddress(seeds: Uint8Array[], programId: string): [string, number] {
  const program = base58Decode(programId)
  const marker = new TextEncoder().encode('ProgramDerivedAddress')
  for (let bump = 255; bump >= 0; bump -= 1) {
    const parts = [...seeds, Uint8Array.of(bump), program, marker]
    const buffer = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
      buffer.set(part, offset)
      offset += part.length
    }
    const hash = sha256(buffer)
    if (!isOnCurve(hash)) return [base58Encode(hash), bump]
  }
  throw new Error('Unable to find a viable program address')
}

/** `PublicKey.createWithSeed`: an account address owned by `programId` that only `base` can create. */
export function createWithSeed(base: string, seed: string, programId: string): string {
  const parts = [base58Decode(base), new TextEncoder().encode(seed), base58Decode(programId)]
  const buffer = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    buffer.set(part, offset)
    offset += part.length
  }
  return base58Encode(sha256(buffer))
}

export const SYSTEM_PROGRAM = '11111111111111111111111111111111'
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
export const TOKEN_METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
export const RENT_SYSVAR = 'SysvarRent111111111111111111111111111111111'

export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string) {
  return findProgramAddress([base58Decode(owner), base58Decode(tokenProgram), base58Decode(mint)], ASSOCIATED_TOKEN_PROGRAM)[0]
}

export function metadataAddress(mint: string) {
  return findProgramAddress([new TextEncoder().encode('metadata'), base58Decode(TOKEN_METADATA_PROGRAM), base58Decode(mint)], TOKEN_METADATA_PROGRAM)[0]
}
