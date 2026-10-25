export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
export const MEMO_PROGRAM_V1 = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111'

const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM])
const MEMO_PROGRAMS = new Set([MEMO_PROGRAM, MEMO_PROGRAM_V1])
const ALLOWED_PROGRAMS = new Set([...TOKEN_PROGRAMS, ...MEMO_PROGRAMS, COMPUTE_BUDGET_PROGRAM])

/** The subset of a jsonParsed transaction the verifier relies on. */
export interface ParsedTx {
  slot: number
  blockTime?: number | null
  meta: {
    err: unknown
    preTokenBalances?: TokenBalance[] | null
    postTokenBalances?: TokenBalance[] | null
  } | null
  transaction: {
    signatures: string[]
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean }[]
      instructions: ParsedIx[]
    }
  }
}

export interface TokenBalance {
  accountIndex: number
  mint: string
  owner?: string
  uiTokenAmount: { amount: string; decimals: number }
}

export type ParsedIx =
  | { programId: string; program?: string; parsed: unknown }
  | { programId: string; data: string; accounts: string[] }

export interface BurnExpectation {
  mint: string
  amountRaw: bigint
  decimals: number
  memo: string
}

export type BurnVerification =
  | {
      ok: true
      signature: string
      wallet: string
      tokenAccount: string
      tokenProgram: string
      slot: number
      blockTime: number | null
    }
  | { ok: false; code: VerifyErrorCode; message: string }

export type VerifyErrorCode =
  | 'TX_NOT_FOUND'
  | 'TX_FAILED'
  | 'UNEXPECTED_PROGRAM'
  | 'NO_BURN'
  | 'MULTIPLE_BURNS'
  | 'WRONG_MINT'
  | 'WRONG_AMOUNT'
  | 'WRONG_DECIMALS'
  | 'AUTHORITY_NOT_SIGNER'
  | 'MEMO_MISMATCH'
  | 'BALANCE_MISMATCH'

function fail(code: VerifyErrorCode, message: string): BurnVerification {
  return { ok: false, code, message }
}

interface BurnInfo {
  account: string
  mint: string
  authority?: string
  multisigAuthority?: string
  amount?: string
  tokenAmount?: { amount: string; decimals: number }
}

function isParsed(ix: ParsedIx): ix is { programId: string; parsed: unknown } {
  return 'parsed' in ix
}

export function verifyBurnTransaction(tx: ParsedTx | null, expected: BurnExpectation): BurnVerification {
  if (!tx) return fail('TX_NOT_FOUND', 'The transaction was not found at the required commitment.')
  if (!tx.meta) return fail('TX_NOT_FOUND', 'The transaction has no execution metadata.')
  if (tx.meta.err) return fail('TX_FAILED', 'The transaction failed on-chain. No tokens were burned.')

  const { instructions, accountKeys } = tx.transaction.message
  for (const ix of instructions) {
    if (!ALLOWED_PROGRAMS.has(ix.programId)) {
      return fail('UNEXPECTED_PROGRAM', 'The transaction calls a program other than Token, Memo or Compute Budget.')
    }
  }

  const burns = instructions.filter((ix) => TOKEN_PROGRAMS.has(ix.programId))
  if (burns.length === 0) return fail('NO_BURN', 'No token burn instruction was found.')
  if (burns.length > 1) return fail('MULTIPLE_BURNS', 'Exactly one token instruction is allowed in a burn transaction.')
  const burnIx = burns[0]
  if (!isParsed(burnIx)) return fail('NO_BURN', 'The token instruction could not be parsed.')
  const parsed = burnIx.parsed as { type?: string; info?: BurnInfo }
  if (parsed.type !== 'burnChecked' && parsed.type !== 'burn') return fail('NO_BURN', 'The token instruction is not a burn.')
  const info = parsed.info
  if (!info) return fail('NO_BURN', 'The burn instruction has no details.')

  if (info.mint !== expected.mint) return fail('WRONG_MINT', 'The burned tokens are not QFORK.')
  const raw = parsed.type === 'burnChecked' ? info.tokenAmount?.amount : info.amount
  if (raw === undefined || BigInt(raw) !== expected.amountRaw) return fail('WRONG_AMOUNT', 'The burned amount does not match the required amount.')
  if (parsed.type === 'burnChecked' && info.tokenAmount?.decimals !== expected.decimals) {
    return fail('WRONG_DECIMALS', 'The burn was checked against the wrong number of decimals.')
  }

  const authority = info.authority
  if (!authority || info.multisigAuthority) return fail('AUTHORITY_NOT_SIGNER', 'Multisig burns are not accepted.')
  const authorityKey = accountKeys.find((key) => key.pubkey === authority)
  if (!authorityKey?.signer) return fail('AUTHORITY_NOT_SIGNER', 'The burn authority did not sign the transaction.')

  const memos = instructions.filter((ix) => MEMO_PROGRAMS.has(ix.programId))
  const memoMatches = memos.filter((ix) => isParsed(ix) && ix.parsed === expected.memo)
  if (memos.length !== 1 || memoMatches.length !== 1) return fail('MEMO_MISMATCH', 'The memo does not bind this burn to the deployment.')

  const accountIndex = accountKeys.findIndex((key) => key.pubkey === info.account)
  const pre = tx.meta.preTokenBalances?.find((balance) => balance.accountIndex === accountIndex && balance.mint === expected.mint)
  const post = tx.meta.postTokenBalances?.find((balance) => balance.accountIndex === accountIndex && balance.mint === expected.mint)
  const before = BigInt(pre?.uiTokenAmount.amount ?? '0')
  const after = BigInt(post?.uiTokenAmount.amount ?? '0')
  if (!pre || before - after !== expected.amountRaw) return fail('BALANCE_MISMATCH', 'Token balances do not show the burned amount leaving the account.')

  return {
    ok: true,
    signature: tx.transaction.signatures[0],
    wallet: authority,
    tokenAccount: info.account,
    tokenProgram: burnIx.programId,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
  }
}
