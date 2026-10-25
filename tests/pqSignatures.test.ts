import { readFileSync } from 'node:fs'
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js'
import { slh_dsa_sha2_128f, slh_dsa_sha2_128s, slh_dsa_shake_128f, slh_dsa_shake_128s } from '@noble/post-quantum/slh-dsa.js'
import { bytesToHex, hexToBytes, sha256 } from 'viem'
import { describe, expect, it } from 'vitest'
import { calldataGas, CURVES_LIBRARY, measure, median, PQ_LIBRARY, SCHEMES } from '../src/protocol/pqSignatures'

/** NIST ACVP vectors (FIPS 204 / FIPS 205), extracted from usnistgov/ACVP-Server. */
const vectors = JSON.parse(readFileSync(new URL('./fixtures/acvp-pq.json', import.meta.url), 'utf8')) as {
  mldsaKeyGen: { set: string; tcId: number; seed: string; pkSha256: string; skSha256: string }[]
  slhdsaKeyGen: { set: string; tcId: number; seed: string; pk: string; skSha256: string }[]
  mldsaSigVer: { set: string; tcId: number; pk: string; message: string; context: string; signature: string; valid: boolean; reason: string }[]
}
const ML_DSA = { 'ML-DSA-44': ml_dsa44, 'ML-DSA-65': ml_dsa65, 'ML-DSA-87': ml_dsa87 } as const
const SLH_DSA = { 'SLH-DSA-SHA2-128f': slh_dsa_sha2_128f, 'SLH-DSA-SHA2-128s': slh_dsa_sha2_128s, 'SLH-DSA-SHAKE-128f': slh_dsa_shake_128f, 'SLH-DSA-SHAKE-128s': slh_dsa_shake_128s } as const
const hex = (value: string) => hexToBytes(`0x${value}`)
const digest = (bytes: Uint8Array) => sha256(bytes).slice(2)

describe('NIST ACVP known answers', () => {
  it.each(vectors.mldsaKeyGen.map((test) => [test.set, test.tcId, test] as const))('%s keyGen tcId %i', (set, _id, test) => {
    const keys = ML_DSA[set as keyof typeof ML_DSA].keygen(hex(test.seed))
    expect(digest(keys.publicKey)).toBe(test.pkSha256)
    expect(digest(keys.secretKey)).toBe(test.skSha256)
  })

  it.each(vectors.slhdsaKeyGen.map((test) => [test.set, test.tcId, test] as const))('%s keyGen tcId %i', (set, _id, test) => {
    const keys = SLH_DSA[set as keyof typeof SLH_DSA].keygen(hex(test.seed))
    expect(bytesToHex(keys.publicKey).slice(2)).toBe(test.pk)
    expect(digest(keys.secretKey)).toBe(test.skSha256)
  })

  it.each(vectors.mldsaSigVer.map((test) => [test.set, test.tcId, test.reason, test] as const))('%s sigVer tcId %i (%s)', (set, _id, _reason, test) => {
    const valid = ML_DSA[set as keyof typeof ML_DSA].verify(hex(test.signature), hex(test.message), hex(test.pk), { context: hex(test.context) })
    expect(valid).toBe(test.valid)
  })

  it('covers both outcomes for every ML-DSA level', () => {
    for (const set of Object.keys(ML_DSA)) {
      const cases = vectors.mldsaSigVer.filter((test) => test.set === set)
      expect(cases.some((test) => test.valid)).toBe(true)
      expect(cases.some((test) => !test.valid)).toBe(true)
    }
  })
})

describe('schemes', () => {
  it.each(SCHEMES.map((scheme) => [scheme.id, scheme] as const))('%s signs, verifies and rejects a tampered signature', (_id, scheme) => {
    const result = measure(scheme, { budgetMs: 0, maxRuns: 1 })
    expect(result.verified).toBe(true)
    expect(result.rejectedTamper).toBe(true)
    expect(result.runs).toEqual({ keygen: 1, sign: 1, verify: 1 })
  })

  it('reports the sizes the standards define', () => {
    const sizes = Object.fromEntries(SCHEMES.map((scheme) => [scheme.id, measure(scheme, { budgetMs: 0, maxRuns: 1 })]))
    expect([sizes['ecdsa-secp256k1'].publicKeyBytes, sizes['ecdsa-secp256k1'].signatureBytes]).toEqual([33, 65])
    expect([sizes['ecdsa-p256'].publicKeyBytes, sizes['ecdsa-p256'].signatureBytes]).toEqual([33, 64])
    expect([sizes['ml-dsa-44'].publicKeyBytes, sizes['ml-dsa-44'].signatureBytes]).toEqual([1312, 2420])
    expect([sizes['ml-dsa-65'].publicKeyBytes, sizes['ml-dsa-65'].signatureBytes]).toEqual([1952, 3309])
    expect([sizes['ml-dsa-87'].publicKeyBytes, sizes['ml-dsa-87'].signatureBytes]).toEqual([2592, 4627])
    expect([sizes['slh-dsa-sha2-128f'].publicKeyBytes, sizes['slh-dsa-sha2-128f'].signatureBytes]).toEqual([32, 17088])
    expect([sizes['slh-dsa-sha2-128s'].publicKeyBytes, sizes['slh-dsa-sha2-128s'].signatureBytes]).toEqual([32, 7856])
  })

  it('prices calldata per EIP-2028', () => {
    expect(calldataGas(new Uint8Array([0, 1, 0, 255]))).toBe(4 + 16 + 4 + 16)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('names the installed library versions', () => {
    const lock = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }
    expect(lock.dependencies[PQ_LIBRARY.name]).toBe(PQ_LIBRARY.version)
    expect(lock.dependencies[CURVES_LIBRARY.name]).toBe(CURVES_LIBRARY.version)
  })
})
