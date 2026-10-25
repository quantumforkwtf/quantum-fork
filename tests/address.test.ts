import { PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import { base58Decode, base58Encode, findProgramAddress, isBase58Address, isSignature } from '../src/protocol/address'
import { curvePriceInSol, decodeBondingCurve, PUMP_PROGRAM_ID } from '../src/protocol/pumpfun'

const MINT = 'So11111111111111111111111111111111111111112'

describe('address helpers', () => {
  it('round-trips base58 like web3.js', () => {
    for (const address of [MINT, PUMP_PROGRAM_ID, '11111111111111111111111111111111']) {
      expect(base58Encode(base58Decode(address))).toBe(address)
      expect(Array.from(base58Decode(address))).toEqual(Array.from(new PublicKey(address).toBytes()))
    }
  })

  it('validates lengths, not just alphabet', () => {
    expect(isBase58Address(MINT)).toBe(true)
    expect(isBase58Address('1'.repeat(33))).toBe(false)
    expect(isSignature('1'.repeat(65))).toBe(false)
    expect(isSignature(base58Encode(new Uint8Array(64).fill(7)))).toBe(true)
  })

  it('derives the same Pump bonding-curve PDA as web3.js', () => {
    const seeds = [new TextEncoder().encode('bonding-curve'), new PublicKey(MINT).toBytes()]
    const [expected, bump] = PublicKey.findProgramAddressSync(seeds, new PublicKey(PUMP_PROGRAM_ID))
    expect(findProgramAddress(seeds, PUMP_PROGRAM_ID)).toEqual([expected.toBase58(), bump])
  })
})

describe('bonding curve decoder', () => {
  const account = () => {
    const data = new Uint8Array(151)
    data.set([23, 183, 248, 55, 96, 216, 172, 96])
    const view = new DataView(data.buffer)
    view.setBigUint64(8, 1_073_000_000_000_000n, true)
    view.setBigUint64(16, 30_000_000_000n, true)
    view.setBigUint64(24, 793_100_000_000_000n, true)
    view.setBigUint64(32, 0n, true)
    view.setBigUint64(40, 1_000_000_000_000_000n, true)
    data[48] = 0
    data.set(new PublicKey(MINT).toBytes(), 49)
    return data
  }

  it('reads reserves, completion and creator', () => {
    const state = decodeBondingCurve(account())
    expect(state?.complete).toBe(false)
    expect(state?.tokenTotalSupply).toBe(1_000_000_000_000_000n)
    expect(state && base58Encode(state.creator as Uint8Array)).toBe(MINT)
    expect(state?.quoteIsSol).toBe(true)
    expect(curvePriceInSol(state!, 6)).toBeCloseTo(30 / 1_073_000_000, 15)
  })

  it('rejects other account types', () => {
    const data = account()
    data[0] = 0
    expect(decodeBondingCurve(data)).toBeNull()
  })
})
