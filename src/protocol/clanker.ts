import { decodeEventLog, getAddress, type Hex, parseAbi } from 'viem'
import type { EvmReceipt, EvmTx } from './base.js'

/** Clanker v4 factory. The same address on Base and Base Sepolia (clanker-devco/v4-contracts). */
export const CLANKER_FACTORY: Hex = '0xE85A59c628F7d27878ACeB4bf3b35733630083a9'

/** Every Clanker v4 token: 100 billion supply, 18 decimals. */
export const CLANKER_DECIMALS = 18
export const CLANKER_SUPPLY_RAW = 100_000_000_000n * 10n ** 18n

export const CLANKER_EVENTS = parseAbi([
  'event TokenCreated(address msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address mevModule, uint256 extensionsSupply, address[] extensions)',
])

/** Immutable on-chain context that ties a Clanker token to one descendant. */
export function clankerContext(deploymentId: string, descendantId: string) {
  return { interface: 'Quantum Fork', platform: 'quantumfork.wtf', messageId: deploymentId, id: descendantId }
}

export interface ClankerExpectation {
  chainId: number
  owner: Hex
  /** The exact calldata the server prepared. */
  data: Hex
  deploymentId: string
}

export type ClankerVerification =
  | { ok: true; token: Hex; name: string; symbol: string; image: string; pairedToken: Hex; blockNumber: bigint }
  | { ok: false; code: string; message: string }

const fail = (code: string, message: string): ClankerVerification => ({ ok: false, code, message })
const same = (a: string | null | undefined, b: string) => Boolean(a) && a!.toLowerCase() === b.toLowerCase()

/**
 * Checks a Clanker deployToken transaction against what the server prepared: the right chain,
 * factory, sender and calldata, and exactly one TokenCreated event naming the owner and this descendant.
 */
export function verifyClankerCreation(tx: EvmTx | null, receipt: EvmReceipt | null, expected: ClankerExpectation): ClankerVerification {
  if (!tx || !receipt) return fail('TX_NOT_FOUND', 'The transaction is not on Base yet.')
  if (receipt.status !== 'success') return fail('TX_FAILED', 'The transaction failed on-chain. No token was created.')
  if (tx.chainId !== undefined && tx.chainId !== expected.chainId) return fail('WRONG_CHAIN', 'The transaction was sent on a different chain.')
  if (!same(tx.to, CLANKER_FACTORY)) return fail('WRONG_CONTRACT', 'The transaction did not call the Clanker v4 factory.')
  if (!same(tx.from, expected.owner)) return fail('WRONG_SENDER', 'The transaction was not sent by the wallet that registered this descendant.')
  if (tx.input.toLowerCase() !== expected.data.toLowerCase()) return fail('TX_MODIFIED', 'The transaction differs from the one prepared for review.')
  if (tx.value !== 0n) return fail('VALUE_SENT', 'The transaction sent ETH, which the prepared launch does not.')

  const created = []
  for (const log of receipt.logs) {
    if (!same(log.address, CLANKER_FACTORY)) continue
    try {
      const event = decodeEventLog({ abi: CLANKER_EVENTS, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
      if (event.eventName === 'TokenCreated') created.push(event.args)
    } catch {
      // Other factory events.
    }
  }
  if (created.length !== 1) return fail('NO_TOKEN_CREATED', 'The transaction did not create exactly one Clanker token.')
  const event = created[0]
  if (!same(event.tokenAdmin, expected.owner) || !same(event.msgSender, expected.owner)) return fail('ADMIN_MISMATCH', 'The token admin is not the descendant’s owner.')
  let context: { messageId?: unknown } | null = null
  try {
    context = JSON.parse(event.tokenContext) as { messageId?: unknown }
  } catch {
    context = null
  }
  if (context?.messageId !== expected.deploymentId) return fail('CONTEXT_MISMATCH', 'The token is not tagged with this descendant.')
  return { ok: true, token: getAddress(event.tokenAddress), name: event.tokenName, symbol: event.tokenSymbol, image: event.tokenImage, pairedToken: getAddress(event.pairedToken), blockNumber: receipt.blockNumber }
}

/** clanker.world lists Base mainnet tokens only. */
export function clankerLink(token: string, network: string): string | null {
  return network === 'base' ? `https://www.clanker.world/clanker/${token}` : null
}
