import { concat, decodeEventLog, encodeFunctionData, type Hex, isAddress, keccak256, parseAbi, toBytes, getAddress } from 'viem'
import type { TokenStatus } from './config.js'

export type BaseNetwork = 'base' | 'base-sepolia'
export type Chain = 'solana' | 'base'

export const BASE_CHAIN_ID: Record<BaseNetwork, number> = { base: 8453, 'base-sepolia': 84532 }
export const BASE_PUBLIC_RPC: Record<BaseNetwork, string> = { base: 'https://mainnet.base.org', 'base-sepolia': 'https://sepolia.base.org' }
export const BASE_EXPLORER: Record<BaseNetwork, string> = { base: 'https://basescan.org', 'base-sepolia': 'https://sepolia.basescan.org' }

export const ERC20_BURN_ABI = parseAbi([
  'function burn(uint256 value)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])

const ZERO = '0x0000000000000000000000000000000000000000'
/** burn(uint256) selector + one 32-byte argument + the 32-byte deployment tag. */
const BURN_CALLDATA_BYTES = 4 + 32 + 32

export interface BaseConfig {
  network: BaseNetwork
  chainId: number
  token: Hex | null
  tokenStatus: TokenStatus
  deployments: boolean
  /** Descendant owners may launch tokens through the Clanker v4 factory. */
  clankerLaunch: boolean
  clankerUrl: string | null
  /** QForkRegistry on this Base network. Null until it is deployed and configured. */
  registry: Hex | null
}

export interface BaseIssue {
  key: string
  level: 'error' | 'warning'
  message: string
}

type Env = Record<string, string | boolean | undefined>

function text(env: Env, key: string) {
  const value = env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Base settings. Defaults to Base Sepolia with registration off; anything inconsistent resolves to off. */
export function resolveBaseConfig(env: Env, prefix = ''): { config: BaseConfig; issues: BaseIssue[] } {
  const issues: BaseIssue[] = []
  const key = (name: string) => `${prefix}${name}`

  const rawNetwork = text(env, key('BASE_NETWORK')) ?? 'base-sepolia'
  let network: BaseNetwork = 'base-sepolia'
  if (rawNetwork === 'base' || rawNetwork === 'base-mainnet') network = 'base'
  else if (rawNetwork !== 'base-sepolia') issues.push({ key: key('BASE_NETWORK'), level: 'error', message: `Unknown Base network "${rawNetwork}". Falling back to Base Sepolia.` })

  const rawToken = text(env, key('QFORK_BASE_TOKEN'))
  let token: Hex | null = null
  if (rawToken) {
    if (isAddress(rawToken)) token = getAddress(rawToken)
    else issues.push({ key: key('QFORK_BASE_TOKEN'), level: 'error', message: 'QFORK_BASE_TOKEN is not a valid 0x address. Base burns are disabled.' })
  }

  let tokenStatus: TokenStatus = text(env, key('BASE_TOKEN_STATUS')) === 'LIVE' ? 'LIVE' : 'PRELAUNCH'
  if (tokenStatus === 'LIVE' && !token) {
    issues.push({ key: key('BASE_TOKEN_STATUS'), level: 'error', message: 'BASE_TOKEN_STATUS is LIVE but no Base token is configured. Treating it as PRELAUNCH.' })
    tokenStatus = 'PRELAUNCH'
  }

  const rawFlag = env[key('ENABLE_BASE_DEPLOYMENTS')]
  let deployments = rawFlag === true || rawFlag === 'true' || rawFlag === '1'
  if (deployments && !token) {
    issues.push({ key: key('ENABLE_BASE_DEPLOYMENTS'), level: 'warning', message: 'Base registration needs QFORK_BASE_TOKEN. It stays off.' })
    deployments = false
  }
  if (deployments && network === 'base' && tokenStatus !== 'LIVE') {
    issues.push({ key: key('ENABLE_BASE_DEPLOYMENTS'), level: 'warning', message: 'Base mainnet registration needs BASE_TOKEN_STATUS=LIVE. It stays off.' })
    deployments = false
  }

  const rawLaunch = env[key('ENABLE_CLANKER_LAUNCH')]
  const clankerLaunch = rawLaunch === true || rawLaunch === 'true' || rawLaunch === '1'

  const rawRegistry = text(env, key('QFORK_REGISTRY_ADDRESS'))
  let registry: Hex | null = null
  if (rawRegistry) {
    if (isAddress(rawRegistry)) registry = getAddress(rawRegistry)
    else issues.push({ key: key('QFORK_REGISTRY_ADDRESS'), level: 'error', message: 'QFORK_REGISTRY_ADDRESS is not a valid 0x address. Anchoring is disabled.' })
  }

  const clankerUrl = token && tokenStatus === 'LIVE' && network === 'base' ? `https://www.clanker.world/clanker/${token}` : null
  return { config: { network, chainId: BASE_CHAIN_ID[network], token, tokenStatus, deployments, clankerLaunch, clankerUrl, registry }, issues }
}

/** Which registration tier a Base network maps to. */
/** The chain a descendant burned on. Records from before Base support are Solana; unregistered drafts use `fallback`. */
export function burnChainOf(item: { receipt?: { chain?: Chain } | null; deployment?: { burn: { chain?: Chain } } | null }, fallback: Chain): Chain {
  if (item.receipt) return item.receipt.chain ?? 'solana'
  if (item.deployment) return item.deployment.burn.chain ?? 'solana'
  return fallback
}

export function baseTier(network: BaseNetwork): 'mainnet' | 'testnet' {
  return network === 'base' ? 'mainnet' : 'testnet'
}

export function baseAvailability(config: BaseConfig, persistent: boolean): { available: boolean; reason: string } {
  const name = config.network === 'base' ? 'Base' : 'Base Sepolia'
  if (!persistent) return { available: false, reason: 'Server storage is not configured, so burn receipts cannot be kept. Registration is switched off.' }
  if (!config.token) return { available: false, reason: `Registration on ${name} opens when $QFORK launches on Base.` }
  if (!config.deployments) return { available: false, reason: `Registration on ${name} is switched off (ENABLE_BASE_DEPLOYMENTS).` }
  return config.network === 'base'
    ? { available: true, reason: 'Burns real $QFORK on Base, verified on-chain by the server.' }
    : { available: true, reason: 'Burns Base Sepolia test QFORK, verified on-chain by the server. Test tokens have no value.' }
}

/** 32-byte tag appended to the burn calldata; binds one burn to one deployment, like the Solana memo. */
export function burnTag(memo: string): Hex {
  return keccak256(toBytes(memo))
}

/** Calldata for `burn(amount)` with the deployment tag appended. Solidity ignores the trailing bytes. */
export function burnCalldata(amountRaw: bigint, tag: Hex): Hex {
  return concat([encodeFunctionData({ abi: ERC20_BURN_ABI, functionName: 'burn', args: [amountRaw] }), tag])
}

export interface EvmTx {
  hash: Hex
  from: Hex
  to: Hex | null
  input: Hex
  value: bigint
  chainId?: number
}

export interface EvmLog {
  address: Hex
  topics: readonly Hex[] | Hex[]
  data: Hex
}

export interface EvmReceipt {
  status: 'success' | 'reverted'
  blockNumber: bigint
  logs: EvmLog[]
}

export interface EvmBurnExpectation {
  token: Hex
  amountRaw: bigint
  tag: Hex
  chainId: number
}

export type EvmVerifyCode =
  | 'TX_NOT_FOUND'
  | 'TX_FAILED'
  | 'WRONG_CHAIN'
  | 'WRONG_CONTRACT'
  | 'NOT_A_BURN'
  | 'WRONG_AMOUNT'
  | 'TAG_MISMATCH'
  | 'VALUE_SENT'
  | 'NO_BURN'
  | 'MULTIPLE_BURNS'
  | 'BALANCE_MISMATCH'

export type EvmBurnVerification = { ok: true; wallet: Hex; blockNumber: bigint } | { ok: false; code: EvmVerifyCode; message: string }

function fail(code: EvmVerifyCode, message: string): EvmBurnVerification {
  return { ok: false, code, message }
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * Verifies a Base burn from the transaction and its receipt. Finality is the caller's job.
 * Only a direct call from the wallet to `token.burn(amount)` with the deployment tag is accepted,
 * and the receipt must show exactly that amount leaving the wallet to the zero address.
 */
export function verifyEvmBurn(tx: EvmTx | null, receipt: EvmReceipt | null, expected: EvmBurnExpectation): EvmBurnVerification {
  if (!tx || !receipt) return fail('TX_NOT_FOUND', 'The transaction was not found.')
  if (receipt.status !== 'success') return fail('TX_FAILED', 'The transaction reverted on-chain. No tokens were burned.')
  if (tx.chainId !== undefined && tx.chainId !== expected.chainId) return fail('WRONG_CHAIN', 'The transaction was sent on a different chain.')
  if (!same(tx.to, expected.token)) return fail('WRONG_CONTRACT', 'The transaction does not call the QFORK token contract directly. Smart-contract wallets are not supported for burns yet.')
  if (tx.value !== 0n) return fail('VALUE_SENT', 'A burn must not send ETH.')

  const input = tx.input.toLowerCase() as Hex
  const selector = encodeFunctionData({ abi: ERC20_BURN_ABI, functionName: 'burn', args: [0n] }).slice(0, 10)
  if (!input.startsWith(selector) || (input.length - 2) / 2 !== BURN_CALLDATA_BYTES) return fail('NOT_A_BURN', 'The transaction is not a tagged burn(amount) call.')
  const amount = BigInt(`0x${input.slice(10, 74)}`)
  if (amount !== expected.amountRaw) return fail('WRONG_AMOUNT', 'The burned amount does not match the required amount.')
  if (`0x${input.slice(74)}` !== expected.tag.toLowerCase()) return fail('TAG_MISMATCH', 'The burn is not tagged for this deployment.')

  const transfers = receipt.logs
    .filter((log) => same(log.address, expected.token))
    .flatMap((log) => {
      try {
        const event = decodeEventLog({ abi: ERC20_BURN_ABI, eventName: 'Transfer', topics: log.topics as [Hex, ...Hex[]], data: log.data })
        return [event.args]
      } catch {
        return []
      }
    })
  if (transfers.length === 0) return fail('NO_BURN', 'The receipt shows no QFORK transfer.')
  if (transfers.length > 1) return fail('MULTIPLE_BURNS', 'Exactly one QFORK transfer is allowed in a burn transaction.')
  const [transfer] = transfers
  if (!same(transfer.from, tx.from) || !same(transfer.to, ZERO) || transfer.value !== expected.amountRaw) {
    return fail('BALANCE_MISMATCH', 'The receipt does not show the burned amount leaving the wallet to the zero address.')
  }
  return { ok: true, wallet: getAddress(tx.from), blockNumber: receipt.blockNumber }
}

/** Whether the receipt shows any of the token being sent to the zero address, whatever else went wrong. */
export function burnedInReceipt(receipt: EvmReceipt | null, token: Hex): boolean {
  if (!receipt || receipt.status !== 'success') return false
  return receipt.logs.some((log) => {
    if (!same(log.address, token)) return false
    try {
      const event = decodeEventLog({ abi: ERC20_BURN_ABI, eventName: 'Transfer', topics: log.topics as [Hex, ...Hex[]], data: log.data })
      return same(event.args.to, ZERO)
    } catch {
      return false
    }
  })
}

export function baseExplorerTx(hash: string, network: BaseNetwork) {
  return `${BASE_EXPLORER[network]}/tx/${hash}`
}

export function baseExplorerAddress(address: string, network: BaseNetwork) {
  return `${BASE_EXPLORER[network]}/address/${address}`
}

export function isTxHash(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
}
