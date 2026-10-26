import type { DescendantConfig } from './descendant.js'
import type { Chain } from './base.js'
import { MODULE_BY_ID } from './modules.js'

/**
 * Provisional protocol parameters. They are published so the burn requirement
 * is predictable, and they may change before token launch.
 */
export const PRICING = {
  status: 'PROVISIONAL' as const,
  genesisBase: 100_000,
  forkBase: 50_000,
  highPerformanceValidators: 25_000,
  privateRpc: 10_000,
  decimals: 6,
}

export interface BurnLine {
  label: string
  amount: number
}

export interface BurnQuote {
  purpose: 'GENESIS' | 'FORK'
  lines: BurnLine[]
  total: number
}

/**
 * Burn multiplier per chain. $QFORK on Base has 1B supply; at 10x a registration
 * base burns 1,000,000 QFORK, 0.1% of supply.
 */
export const CHAIN_BURN_SCALE: Record<Chain, number> = { solana: 1, base: 10 }

export function quoteGenesis(config: DescendantConfig, purpose: BurnQuote['purpose'] = 'GENESIS', chain: Chain = 'solana'): BurnQuote {
  const scale = CHAIN_BURN_SCALE[chain]
  const lines: BurnLine[] = [{ label: purpose === 'GENESIS' ? 'Registration base' : 'Fork base', amount: purpose === 'GENESIS' ? PRICING.genesisBase : PRICING.forkBase }]
  for (const id of config.modules) lines.push({ label: `${MODULE_BY_ID[id].code} ${MODULE_BY_ID[id].name}`, amount: MODULE_BY_ID[id].burn })
  if (config.validators.hardware === 'high') lines.push({ label: 'High-performance validators', amount: PRICING.highPerformanceValidators })
  if (config.rpc.access === 'private') lines.push({ label: 'Private RPC', amount: PRICING.privateRpc })
  const scaled = lines.map((line) => ({ ...line, amount: line.amount * scale }))
  return { purpose, lines: scaled, total: scaled.reduce((sum, line) => sum + line.amount, 0) }
}

/** Whole QFORK to base units. Integers only; QFORK amounts never use floats on the wire. */
export function toBaseUnits(amount: number, decimals = PRICING.decimals): bigint {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Burn amounts must be non-negative whole tokens')
  return BigInt(amount) * 10n ** BigInt(decimals)
}

export function formatBaseUnits(raw: bigint | string, decimals: number) {
  const value = typeof raw === 'string' ? BigInt(raw) : raw
  const unit = 10n ** BigInt(decimals)
  const whole = value / unit
  const fraction = value % unit
  const wholeText = whole.toLocaleString('en-US')
  if (fraction === 0n) return wholeText
  return `${wholeText}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}
