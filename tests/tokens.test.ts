import {
  AuthorityType,
  createAssociatedTokenAccountIdempotentInstruction as splCreateAta,
  createInitializeMint2Instruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import {
  createAccountWithSeedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMetadataInstruction,
  type Instruction,
  initializeMint2Instruction,
  mintToCheckedInstruction,
  revokeMintAuthorityInstruction,
  transferInstruction,
} from '../src/lib/solana/tx'
import { associatedTokenAddress, base58Encode, createWithSeed, metadataAddress, RENT_SYSVAR, SYSTEM_PROGRAM, TOKEN_METADATA_PROGRAM } from '../src/protocol/address'
import { PUMP_PROGRAM_ID } from '../src/protocol/pumpfun'
import { decodeMetadataAccount, signerIndex, splSpecSchema, supplyRaw, tokenMemo, verifyPumpCreation, verifySplCreation, withSignature } from '../src/protocol/tokens'
import { MEMO_PROGRAM, type ParsedTx, TOKEN_PROGRAM } from '../src/protocol/verifyBurn'

const owner = Keypair.generate().publicKey
const mint = Keypair.generate().publicKey
const OWNER = owner.toBase58()
const MINT = mint.toBase58()
const DEPLOYMENT = 'dep_0123456789abcdef'

const shape = (ix: Instruction) => ({ programId: ix.programId, keys: ix.keys.map((key) => [key.pubkey, key.isSigner, key.isWritable]), data: Buffer.from(ix.data).toString('hex') })
const web3Shape = (ix: TransactionInstruction) => ({
  programId: ix.programId.toBase58(),
  keys: ix.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable]),
  data: Buffer.from(ix.data).toString('hex'),
})

describe('SPL token instruction encoders match @solana/spl-token and web3.js', () => {
  it('derives seed accounts, token accounts and metadata PDAs identically', async () => {
    const seed = 'qf0123456789abcdefgh'
    expect(createWithSeed(OWNER, seed, TOKEN_PROGRAM)).toBe((await PublicKey.createWithSeed(owner, seed, TOKEN_PROGRAM_ID)).toBase58())
    expect(associatedTokenAddress(OWNER, MINT, TOKEN_PROGRAM)).toBe(getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID).toBase58())
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), new PublicKey(TOKEN_METADATA_PROGRAM).toBuffer(), mint.toBuffer()], new PublicKey(TOKEN_METADATA_PROGRAM))
    expect(metadataAddress(MINT)).toBe(pda.toBase58())
  })

  it('encodes system instructions byte for byte', () => {
    const seed = 'qfabcdefghij0123456'
    const account = createWithSeed(OWNER, seed, TOKEN_PROGRAM)
    expect(shape(createAccountWithSeedInstruction({ payer: OWNER, account, seed, lamports: 1_461_600n, space: 82, owner: TOKEN_PROGRAM }))).toEqual(
      web3Shape(SystemProgram.createAccountWithSeed({ fromPubkey: owner, newAccountPubkey: new PublicKey(account), basePubkey: owner, seed, lamports: 1_461_600, space: 82, programId: TOKEN_PROGRAM_ID })),
    )
    const to = Keypair.generate().publicKey
    expect(shape(transferInstruction(OWNER, to.toBase58(), 5_000n))).toEqual(web3Shape(SystemProgram.transfer({ fromPubkey: owner, toPubkey: to, lamports: 5_000 })))
  })

  it('encodes token instructions byte for byte', () => {
    const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID)
    expect(shape(initializeMint2Instruction({ tokenProgram: TOKEN_PROGRAM, mint: MINT, decimals: 6, mintAuthority: OWNER }))).toEqual(web3Shape(createInitializeMint2Instruction(mint, 6, owner, null, TOKEN_PROGRAM_ID)))
    expect(shape(createAssociatedTokenAccountIdempotentInstruction({ payer: OWNER, account: ata.toBase58(), owner: OWNER, mint: MINT, tokenProgram: TOKEN_PROGRAM }))).toEqual(
      web3Shape(splCreateAta(owner, ata, owner, mint, TOKEN_PROGRAM_ID)),
    )
    expect(shape(mintToCheckedInstruction({ tokenProgram: TOKEN_PROGRAM, mint: MINT, destination: ata.toBase58(), authority: OWNER, amount: 1_000_000_000_000n, decimals: 6 }))).toEqual(
      web3Shape(createMintToCheckedInstruction(mint, ata, owner, 1_000_000_000_000n, 6, [], TOKEN_PROGRAM_ID)),
    )
    expect(shape(revokeMintAuthorityInstruction({ tokenProgram: TOKEN_PROGRAM, mint: MINT, authority: OWNER }))).toEqual(
      web3Shape(createSetAuthorityInstruction(mint, owner, AuthorityType.MintTokens, null, [], TOKEN_PROGRAM_ID)),
    )
  })

  it('lays out CreateMetadataAccountV3 as the Metaplex program reads it', () => {
    const metadata = metadataAddress(MINT)
    const ix = createMetadataInstruction({ metadata, mint: MINT, authority: OWNER, name: 'Lattice', symbol: 'LAT', uri: 'https://quantumfork.wtf/api/tokens?meta=x', mutable: false })
    expect(ix.programId).toBe(TOKEN_METADATA_PROGRAM)
    expect(ix.keys.map((key) => key.pubkey)).toEqual([metadata, MINT, OWNER, OWNER, OWNER, SYSTEM_PROGRAM, RENT_SYSVAR])
    const data = Buffer.from(ix.data)
    expect(data[0]).toBe(33)
    let offset = 1
    const text = () => {
      const length = data.readUInt32LE(offset)
      const value = data.subarray(offset + 4, offset + 4 + length).toString('utf8')
      offset += 4 + length
      return value
    }
    expect([text(), text(), text()]).toEqual(['Lattice', 'LAT', 'https://quantumfork.wtf/api/tokens?meta=x'])
    expect(data.readUInt16LE(offset)).toBe(0)
    expect([...data.subarray(offset + 2)]).toEqual([0, 0, 0, 0, 0])
  })
})

describe('token specs', () => {
  it('computes raw supply and refuses anything past u64', () => {
    expect(supplyRaw({ supply: '1000000', decimals: 6 })).toBe(1_000_000_000_000n)
    expect(() => supplyRaw({ supply: '9999999999999999', decimals: 9 })).toThrow()
  })

  it('rejects malformed symbols, names and supplies', () => {
    const base = { name: 'Lattice', symbol: 'LAT', description: '', decimals: 6, supply: '1000', fixedSupply: true }
    expect(splSpecSchema.safeParse(base).success).toBe(true)
    expect(splSpecSchema.safeParse({ ...base, symbol: 'lat' }).success).toBe(false)
    expect(splSpecSchema.safeParse({ ...base, symbol: 'A' }).success).toBe(false)
    expect(splSpecSchema.safeParse({ ...base, name: 'x'.repeat(33) }).success).toBe(false)
    expect(splSpecSchema.safeParse({ ...base, supply: '0' }).success).toBe(false)
    expect(splSpecSchema.safeParse({ ...base, supply: '-5' }).success).toBe(false)
    expect(splSpecSchema.safeParse({ ...base, decimals: 10 }).success).toBe(false)
  })
})

describe('server-side launch verification', () => {
  const memo = tokenMemo(DEPLOYMENT)
  const splTx = (overrides: { payer?: string; authority?: string; memo?: string; mint?: string; err?: unknown } = {}): ParsedTx => ({
    slot: 12,
    blockTime: 1_760_000_000,
    meta: { err: overrides.err ?? null, preTokenBalances: [], postTokenBalances: [] },
    transaction: {
      signatures: ['x'],
      message: {
        accountKeys: [
          { pubkey: overrides.payer ?? OWNER, signer: true, writable: true },
          { pubkey: MINT, signer: false, writable: true },
        ],
        instructions: [
          { programId: TOKEN_PROGRAM, program: 'spl-token', parsed: { type: 'initializeMint2', info: { mint: overrides.mint ?? MINT, decimals: 6, mintAuthority: overrides.authority ?? OWNER } } },
          { programId: MEMO_PROGRAM, program: 'spl-memo', parsed: overrides.memo ?? memo },
        ],
      },
    },
  })

  it('accepts an SPL creation only from the owner, for this mint and this descendant', () => {
    expect(verifySplCreation(splTx(), { mint: MINT, owner: OWNER, memo })).toMatchObject({ ok: true, creator: OWNER, slot: 12 })
    const other = Keypair.generate().publicKey.toBase58()
    expect(verifySplCreation(splTx({ payer: other }), { mint: MINT, owner: OWNER, memo })).toMatchObject({ ok: false, code: 'WRONG_PAYER' })
    expect(verifySplCreation(splTx({ authority: other }), { mint: MINT, owner: OWNER, memo })).toMatchObject({ ok: false, code: 'WRONG_AUTHORITY' })
    expect(verifySplCreation(splTx({ mint: other }), { mint: MINT, owner: OWNER, memo })).toMatchObject({ ok: false, code: 'NO_MINT_CREATED' })
    expect(verifySplCreation(splTx({ memo: tokenMemo('dep_ffffffffffffffff') }), { mint: MINT, owner: OWNER, memo })).toMatchObject({ ok: false, code: 'MEMO_MISMATCH' })
    expect(verifySplCreation(splTx({ err: { InstructionError: [0, 'Custom'] } }), { mint: MINT, owner: OWNER, memo })).toMatchObject({ ok: false, code: 'TX_FAILED' })
  })

  const pumpTx = (mintSigned: boolean, program = PUMP_PROGRAM_ID): ParsedTx => ({
    slot: 40,
    blockTime: null,
    meta: { err: null, preTokenBalances: [], postTokenBalances: [] },
    transaction: {
      signatures: ['x', 'y'],
      message: {
        accountKeys: [
          { pubkey: OWNER, signer: true, writable: true },
          { pubkey: MINT, signer: mintSigned, writable: true },
        ],
        instructions: [{ programId: program, accounts: [MINT], data: '' }],
      },
    },
  })

  it('accepts a Pump.fun creation only when the fresh mint signed and the Pump program ran', () => {
    expect(verifyPumpCreation(pumpTx(true), { mint: MINT, owner: OWNER })).toMatchObject({ ok: true })
    expect(verifyPumpCreation(pumpTx(false), { mint: MINT, owner: OWNER })).toMatchObject({ ok: false, code: 'MINT_NOT_SIGNER' })
    expect(verifyPumpCreation(pumpTx(true, SYSTEM_PROGRAM), { mint: MINT, owner: OWNER })).toMatchObject({ ok: false, code: 'NOT_PUMP' })
    expect(verifyPumpCreation(pumpTx(true), { mint: MINT, owner: Keypair.generate().publicKey.toBase58() })).toMatchObject({ ok: false, code: 'WRONG_PAYER' })
  })
})

describe('Metaplex metadata account decoding', () => {
  it('reads padded name, symbol and URI', () => {
    const pad = (value: string, size: number) => {
      const bytes = Buffer.alloc(4 + size)
      bytes.writeUInt32LE(size, 0)
      bytes.write(value, 4, 'utf8')
      return bytes
    }
    const data = Buffer.concat([Buffer.of(4), Buffer.alloc(32, 1), mint.toBuffer(), pad('Lattice', 32), pad('LAT', 10), pad('https://x.test/m', 200), Buffer.alloc(16)])
    expect(decodeMetadataAccount(new Uint8Array(data))).toEqual({ mint: MINT, name: 'Lattice', symbol: 'LAT', uri: 'https://x.test/m' })
    expect(decodeMetadataAccount(new Uint8Array(10))).toBeNull()
    expect(decodeMetadataAccount(new Uint8Array(Buffer.concat([Buffer.of(1), data.subarray(1)])))).toBeNull()
  })
})

describe('co-signing a prepared transaction', () => {
  const payer = Keypair.generate()
  const mintKey = Keypair.generate()
  const blockhash = base58Encode(new Uint8Array(32).fill(7))
  const instruction = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: mintKey.publicKey, lamports: 1 })
  instruction.keys[1].isSigner = true

  it('finds signer slots in legacy and v0 transactions', () => {
    const legacy = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(instruction)
    const legacyBytes = new Uint8Array(legacy.serialize({ requireAllSignatures: false, verifySignatures: false }))
    expect(signerIndex(legacyBytes, payer.publicKey.toBase58())).toBe(0)
    expect(signerIndex(legacyBytes, mintKey.publicKey.toBase58())).toBe(1)
    expect(signerIndex(legacyBytes, Keypair.generate().publicKey.toBase58())).toBe(-1)

    const v0 = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [instruction] }).compileToV0Message())
    const v0Bytes = v0.serialize()
    expect(signerIndex(v0Bytes, payer.publicKey.toBase58())).toBe(0)
    expect(signerIndex(v0Bytes, mintKey.publicKey.toBase58())).toBe(1)
  })

  it('writes a signature into exactly the right slot', () => {
    const v0 = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [instruction] }).compileToV0Message())
    const reference = new VersionedTransaction(v0.message)
    reference.sign([mintKey])
    const signed = withSignature(v0.serialize(), 1, reference.signatures[1])
    expect(Buffer.from(signed).equals(Buffer.from(reference.serialize()))).toBe(true)
  })
})
