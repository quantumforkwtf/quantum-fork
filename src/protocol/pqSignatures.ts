import { p256 } from '@noble/curves/p256'
import { secp256k1 } from '@noble/curves/secp256k1'
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js'
import { slh_dsa_sha2_128f, slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js'
import { keccak256, sha256 } from 'viem'

/**
 * Signature schemes measured by Quantum Shield. Every primitive comes from an established
 * library; nothing cryptographic is implemented here. Sizes and timings are always measured
 * from real outputs, never typed in.
 */

export const PQ_LIBRARY = { name: '@noble/post-quantum', version: '0.7.1', audit: 'Not independently audited. Self-audited at 0.6.1 (April 2026), per its README.' } as const
export const CURVES_LIBRARY = { name: '@noble/curves', version: '1.9.7' } as const

export type SchemeId = 'ecdsa-secp256k1' | 'ecdsa-p256' | 'ml-dsa-44' | 'ml-dsa-65' | 'ml-dsa-87' | 'slh-dsa-sha2-128f' | 'slh-dsa-sha2-128s'

export interface Keys {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

export interface Scheme {
  id: SchemeId
  label: string
  standard: string
  /** What breaks it. */
  assumption: string
  quantumSafe: boolean
  /** NIST post-quantum security category, where one is defined. */
  category: string | null
  note: string
  keygen: () => Keys
  sign: (message: Uint8Array, secretKey: Uint8Array) => Uint8Array
  verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean
}

const randomSecret = (curve: typeof secp256k1 | typeof p256) => curve.utils.randomPrivateKey()

export const SCHEMES: readonly Scheme[] = [
  {
    id: 'ecdsa-secp256k1',
    label: 'ECDSA secp256k1',
    standard: 'SEC 2',
    assumption: 'Elliptic-curve discrete log. Broken by Shor’s algorithm on a large quantum computer',
    quantumSafe: false,
    category: null,
    note: 'Signs every Base and Ethereum transaction today. 65-byte r‖s‖v form, keccak256 message hash.',
    keygen: () => {
      const secretKey = randomSecret(secp256k1)
      return { secretKey, publicKey: secp256k1.getPublicKey(secretKey, true) }
    },
    sign: (message, secretKey) => {
      const signature = secp256k1.sign(keccak256(message, 'bytes'), secretKey)
      return new Uint8Array([...signature.toCompactRawBytes(), 27 + signature.recovery])
    },
    verify: (signature, message, publicKey) => signature.length === 65 && secp256k1.verify(signature.slice(0, 64), keccak256(message, 'bytes'), publicKey),
  },
  {
    id: 'ecdsa-p256',
    label: 'ECDSA P-256',
    standard: 'FIPS 186-5',
    assumption: 'Elliptic-curve discrete log. Broken by Shor’s algorithm on a large quantum computer',
    quantumSafe: false,
    category: null,
    note: 'Passkeys. Base verifies it natively with the RIP-7212 precompile at 0x100. 64-byte r‖s form, SHA-256 message hash.',
    keygen: () => {
      const secretKey = randomSecret(p256)
      return { secretKey, publicKey: p256.getPublicKey(secretKey, true) }
    },
    sign: (message, secretKey) => p256.sign(sha256(message, 'bytes'), secretKey).toCompactRawBytes(),
    verify: (signature, message, publicKey) => p256.verify(signature, sha256(message, 'bytes'), publicKey),
  },
  ...(
    [
      [ml_dsa44, 'ml-dsa-44', 'ML-DSA-44', '2'],
      [ml_dsa65, 'ml-dsa-65', 'ML-DSA-65', '3'],
      [ml_dsa87, 'ml-dsa-87', 'ML-DSA-87', '5'],
    ] as const
  ).map(
    ([impl, id, label, category]): Scheme => ({
      id,
      label,
      standard: 'FIPS 204',
      assumption: 'Module lattices (MLWE / MSIS). No known quantum attack',
      quantumSafe: true,
      category,
      note: 'Lattice signatures, standardised by NIST in 2024. The likely default for post-quantum accounts.',
      keygen: () => impl.keygen(),
      sign: (message, secretKey) => impl.sign(message, secretKey),
      verify: (signature, message, publicKey) => impl.verify(signature, message, publicKey),
    }),
  ),
  ...(
    [
      [slh_dsa_sha2_128f, 'slh-dsa-sha2-128f', 'SLH-DSA-SHA2-128f', 'Fast variant: larger signatures, quicker signing.'],
      [slh_dsa_sha2_128s, 'slh-dsa-sha2-128s', 'SLH-DSA-SHA2-128s', 'Small variant: smaller signatures, much slower signing.'],
    ] as const
  ).map(
    ([impl, id, label, variant]): Scheme => ({
      id,
      label,
      standard: 'FIPS 205',
      assumption: 'Hash functions only (SHA-2). The most conservative assumption',
      quantumSafe: true,
      category: '1',
      note: `Stateless hash-based signatures. ${variant}`,
      keygen: () => impl.keygen(),
      sign: (message, secretKey) => impl.sign(message, secretKey),
      verify: (signature, message, publicKey) => impl.verify(signature, message, publicKey),
    }),
  ),
]

export const SCHEME_BY_ID = Object.fromEntries(SCHEMES.map((scheme) => [scheme.id, scheme])) as Record<SchemeId, Scheme>

/** Calldata gas for bytes under EIP-2028 (16 per non-zero byte, 4 per zero byte). Excludes verification and the EIP-7623 floor. */
export function calldataGas(bytes: Uint8Array) {
  let gas = 0
  for (const byte of bytes) gas += byte === 0 ? 4 : 16
  return gas
}

export function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export interface Measurement {
  id: SchemeId
  publicKeyBytes: number
  secretKeyBytes: number
  signatureBytes: number
  signatureCalldataGas: number
  keygenMs: number | null
  signMs: number | null
  verifyMs: number | null
  runs: { keygen: number; sign: number; verify: number }
  verified: boolean
  rejectedTamper: boolean
}

/**
 * Times each operation repeatedly until `budgetMs` is spent or `maxRuns` is reached (at least one
 * run each). Medians are reported. The clock is `performance.now()`, which browsers may coarsen.
 */
export function measure(scheme: Scheme, { budgetMs = 1500, maxRuns = 50, message = new TextEncoder().encode('Quantum Fork · Quantum Shield benchmark') } = {}): Measurement {
  const now = () => performance.now()
  const timed = <T,>(run: () => T) => {
    const times: number[] = []
    let last: T | undefined
    const started = now()
    while (times.length < 1 || (times.length < maxRuns && now() - started < budgetMs)) {
      const t0 = now()
      last = run()
      times.push(now() - t0)
    }
    return { times, last: last as T }
  }
  const keygen = timed(() => scheme.keygen())
  const keys = keygen.last
  const sign = timed(() => scheme.sign(message, keys.secretKey))
  const signature = sign.last
  const verify = timed(() => scheme.verify(signature, message, keys.publicKey))
  const tampered = signature.slice()
  tampered[Math.floor(tampered.length / 2)] ^= 0x01
  return {
    id: scheme.id,
    publicKeyBytes: keys.publicKey.length,
    secretKeyBytes: keys.secretKey.length,
    signatureBytes: signature.length,
    signatureCalldataGas: calldataGas(signature),
    keygenMs: median(keygen.times),
    signMs: median(sign.times),
    verifyMs: median(verify.times),
    runs: { keygen: keygen.times.length, sign: sign.times.length, verify: verify.times.length },
    verified: verify.last,
    rejectedTamper: !scheme.verify(tampered, message, keys.publicKey),
  }
}
