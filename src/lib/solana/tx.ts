import { ASSOCIATED_TOKEN_PROGRAM, base58Decode, base58Encode, RENT_SYSVAR, SYSTEM_PROGRAM, TOKEN_METADATA_PROGRAM } from '../../protocol/address.js'
import { COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM } from '../../protocol/verifyBurn.js'

export interface AccountMeta {
  pubkey: string
  isSigner: boolean
  isWritable: boolean
}

export interface Instruction {
  programId: string
  keys: AccountMeta[]
  data: Uint8Array
}

/** SPL Token / Token-2022 BurnChecked instruction index. */
const BURN_CHECKED = 15

function compactU16(value: number): number[] {
  const out: number[] = []
  let rest = value
  for (;;) {
    const byte = rest & 0x7f
    rest >>= 7
    if (rest === 0) {
      out.push(byte)
      return out
    }
    out.push(byte | 0x80)
  }
}

function u64(value: bigint) {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value, true)
  return bytes
}

function u32(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

export function burnCheckedInstruction(input: { tokenProgram: string; account: string; mint: string; owner: string; amount: bigint; decimals: number }): Instruction {
  return {
    programId: input.tokenProgram,
    keys: [
      { pubkey: input.account, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: true, isWritable: false },
    ],
    data: Uint8Array.from([BURN_CHECKED, ...u64(input.amount), input.decimals]),
  }
}

function u16(value: number) {
  return [value & 0xff, (value >> 8) & 0xff]
}

function borshString(value: string) {
  const bytes = new TextEncoder().encode(value)
  return [...u32(bytes.length), ...bytes]
}

export function transferInstruction(from: string, to: string, lamports: bigint): Instruction {
  return {
    programId: SYSTEM_PROGRAM,
    keys: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
    ],
    data: Uint8Array.from([...u32(2), ...u64(lamports)]),
  }
}

/** System CreateAccountWithSeed with base = payer, so the payer is the only signer. */
export function createAccountWithSeedInstruction(input: { payer: string; account: string; seed: string; lamports: bigint; space: number; owner: string }): Instruction {
  const seed = new TextEncoder().encode(input.seed)
  return {
    programId: SYSTEM_PROGRAM,
    keys: [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.account, isSigner: false, isWritable: true },
    ],
    data: Uint8Array.from([...u32(3), ...base58Decode(input.payer), ...u64(BigInt(seed.length)), ...seed, ...u64(input.lamports), ...u64(BigInt(input.space)), ...base58Decode(input.owner)]),
  }
}

/** InitializeMint2 with no freeze authority. */
export function initializeMint2Instruction(input: { tokenProgram: string; mint: string; decimals: number; mintAuthority: string }): Instruction {
  return {
    programId: input.tokenProgram,
    keys: [{ pubkey: input.mint, isSigner: false, isWritable: true }],
    data: Uint8Array.from([20, input.decimals, ...base58Decode(input.mintAuthority), 0]),
  }
}

export function createAssociatedTokenAccountIdempotentInstruction(input: { payer: string; account: string; owner: string; mint: string; tokenProgram: string }): Instruction {
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.account, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: false, isWritable: false },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: input.tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(1),
  }
}

export function mintToCheckedInstruction(input: { tokenProgram: string; mint: string; destination: string; authority: string; amount: bigint; decimals: number }): Instruction {
  return {
    programId: input.tokenProgram,
    keys: [
      { pubkey: input.mint, isSigner: false, isWritable: true },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: input.authority, isSigner: true, isWritable: false },
    ],
    data: Uint8Array.from([14, ...u64(input.amount), input.decimals]),
  }
}

/** SetAuthority(MintTokens → none): nobody can ever mint more. */
export function revokeMintAuthorityInstruction(input: { tokenProgram: string; mint: string; authority: string }): Instruction {
  return {
    programId: input.tokenProgram,
    keys: [
      { pubkey: input.mint, isSigner: false, isWritable: true },
      { pubkey: input.authority, isSigner: true, isWritable: false },
    ],
    data: Uint8Array.from([6, 0, 0]),
  }
}

/** Metaplex Token Metadata CreateMetadataAccountV3: name, symbol and URI that wallets and explorers display. */
export function createMetadataInstruction(input: { metadata: string; mint: string; authority: string; name: string; symbol: string; uri: string; mutable: boolean }): Instruction {
  return {
    programId: TOKEN_METADATA_PROGRAM,
    keys: [
      { pubkey: input.metadata, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: input.authority, isSigner: true, isWritable: false },
      { pubkey: input.authority, isSigner: true, isWritable: true },
      { pubkey: input.authority, isSigner: true, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.from([33, ...borshString(input.name), ...borshString(input.symbol), ...borshString(input.uri), ...u16(0), 0, 0, 0, input.mutable ? 1 : 0, 0]),
  }
}

export function memoInstruction(memo: string, signer: string): Instruction {
  return { programId: MEMO_PROGRAM, keys: [{ pubkey: signer, isSigner: true, isWritable: false }], data: new TextEncoder().encode(memo) }
}

export function computeUnitLimitInstruction(units: number): Instruction {
  return { programId: COMPUTE_BUDGET_PROGRAM, keys: [], data: Uint8Array.from([2, ...u32(units)]) }
}

export function computeUnitPriceInstruction(microLamports: bigint): Instruction {
  return { programId: COMPUTE_BUDGET_PROGRAM, keys: [], data: Uint8Array.from([3, ...u64(microLamports)]) }
}

/** Compiles a legacy (non-versioned) message. The fee payer is always the first account. */
export function compileLegacyMessage(feePayer: string, instructions: Instruction[], recentBlockhash: string): Uint8Array {
  const order: string[] = [feePayer]
  const flags = new Map<string, { signer: boolean; writable: boolean }>([[feePayer, { signer: true, writable: true }]])
  const add = (pubkey: string, signer: boolean, writable: boolean) => {
    const existing = flags.get(pubkey)
    if (existing) {
      existing.signer ||= signer
      existing.writable ||= writable
    } else {
      flags.set(pubkey, { signer, writable })
      order.push(pubkey)
    }
  }
  for (const instruction of instructions) {
    for (const key of instruction.keys) add(key.pubkey, key.isSigner, key.isWritable)
    add(instruction.programId, false, false)
  }

  const group = (signer: boolean, writable: boolean) => order.filter((key) => key !== feePayer && flags.get(key)!.signer === signer && flags.get(key)!.writable === writable)
  const keys = [feePayer, ...group(true, true), ...group(true, false), ...group(false, true), ...group(false, false)]
  const index = new Map(keys.map((key, position) => [key, position]))
  const signers = keys.filter((key) => flags.get(key)!.signer)
  const readonlySigned = signers.filter((key) => !flags.get(key)!.writable).length
  const readonlyUnsigned = keys.filter((key) => !flags.get(key)!.signer && !flags.get(key)!.writable).length

  const bytes: number[] = [signers.length, readonlySigned, readonlyUnsigned, ...compactU16(keys.length)]
  for (const key of keys) bytes.push(...base58Decode(key))
  bytes.push(...base58Decode(recentBlockhash))
  bytes.push(...compactU16(instructions.length))
  for (const instruction of instructions) {
    bytes.push(index.get(instruction.programId)!)
    bytes.push(...compactU16(instruction.keys.length), ...instruction.keys.map((key) => index.get(key.pubkey)!))
    bytes.push(...compactU16(instruction.data.length), ...instruction.data)
  }
  return Uint8Array.from(bytes)
}

/** Wire transaction with empty signature slots, as wallets expect for signing. */
export function unsignedTransaction(message: Uint8Array): Uint8Array {
  const signatures = message[0]
  return Uint8Array.from([...compactU16(signatures), ...new Uint8Array(64 * signatures), ...message])
}

function signatureSection(transaction: Uint8Array) {
  let count = 0
  let shift = 0
  let offset = 0
  for (;;) {
    const byte = transaction[offset]
    offset += 1
    count |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { count, start: offset, end: offset + count * 64 }
}

export function messageOf(transaction: Uint8Array) {
  return transaction.slice(signatureSection(transaction).end)
}

/** The first signature identifies the transaction on-chain. */
export function firstSignature(transaction: Uint8Array) {
  const { start } = signatureSection(transaction)
  const signature = transaction.slice(start, start + 64)
  return signature.every((byte) => byte === 0) ? null : base58Encode(signature)
}

export function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

export function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

export interface BurnTransactionInput {
  owner: string
  tokenAccount: string
  mint: string
  tokenProgram: string
  amountRaw: bigint
  decimals: number
  memo: string
  recentBlockhash: string
  computeUnits?: number
  microLamports?: bigint
}

/** ComputeBudget + BurnChecked + Memo. Exactly the shape the server verifier accepts. */
export function buildBurnTransaction(input: BurnTransactionInput) {
  const instructions = [computeUnitLimitInstruction(input.computeUnits ?? 40_000)]
  if (input.microLamports && input.microLamports > 0n) instructions.push(computeUnitPriceInstruction(input.microLamports))
  instructions.push(
    burnCheckedInstruction({ tokenProgram: input.tokenProgram, account: input.tokenAccount, mint: input.mint, owner: input.owner, amount: input.amountRaw, decimals: input.decimals }),
    memoInstruction(input.memo, input.owner),
  )
  const message = compileLegacyMessage(input.owner, instructions, input.recentBlockhash)
  return { instructions, message, transaction: unsignedTransaction(message) }
}
