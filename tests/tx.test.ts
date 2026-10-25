import { Keypair, Transaction } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import { buildBurnTransaction, firstSignature, messageOf, sameBytes } from '../src/lib/solana/tx'
import { base58Encode } from '../src/protocol/address'
import { burnMemo } from '../src/protocol/deployment'
import { COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM, TOKEN_2022_PROGRAM } from '../src/protocol/verifyBurn'

describe('burn transaction encoder', () => {
  const owner = Keypair.generate()
  const tokenAccount = Keypair.generate().publicKey.toBase58()
  const mint = Keypair.generate().publicKey.toBase58()
  const blockhash = base58Encode(new Uint8Array(32).fill(9))
  const memo = burnMemo('dep_0123456789abcdef')
  const built = buildBurnTransaction({ owner: owner.publicKey.toBase58(), tokenAccount, mint, tokenProgram: TOKEN_2022_PROGRAM, amountRaw: 270_000_000_000n, decimals: 6, memo, recentBlockhash: blockhash, microLamports: 5000n })

  it('decodes with web3.js into exactly the intended instructions', () => {
    const tx = Transaction.from(built.transaction)
    expect(tx.feePayer?.toBase58()).toBe(owner.publicKey.toBase58())
    expect(tx.recentBlockhash).toBe(blockhash)
    expect(tx.instructions.map((ix) => ix.programId.toBase58())).toEqual([COMPUTE_BUDGET_PROGRAM, COMPUTE_BUDGET_PROGRAM, TOKEN_2022_PROGRAM, MEMO_PROGRAM])

    const burn = tx.instructions[2]
    expect(burn.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable])).toEqual([
      [tokenAccount, false, true],
      [mint, false, true],
      [owner.publicKey.toBase58(), true, true],
    ])
    expect(burn.data[0]).toBe(15)
    expect(Buffer.from(burn.data).readBigUInt64LE(1)).toBe(270_000_000_000n)
    expect(burn.data[9]).toBe(6)
    expect(new TextDecoder().decode(tx.instructions[3].data)).toBe(memo)
  })

  it('produces a message web3.js can sign and verify', () => {
    const tx = Transaction.from(built.transaction)
    tx.sign(owner)
    const signed = tx.serialize()
    expect(sameBytes(messageOf(signed), built.message)).toBe(true)
    expect(firstSignature(signed)).toBe(base58Encode(tx.signature as Uint8Array))
    expect(firstSignature(built.transaction)).toBeNull()
  })
})
