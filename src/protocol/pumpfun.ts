/** Pump bonding-curve program, from the official IDL in pump-fun/pump-public-docs. */
export const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
export const BONDING_CURVE_SEED = 'bonding-curve'
const DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96]

export interface BondingCurveState {
  virtualTokenReserves: bigint
  virtualQuoteReserves: bigint
  realTokenReserves: bigint
  realQuoteReserves: bigint
  tokenTotalSupply: bigint
  complete: boolean
  creator: Uint8Array | null
  /** All-zero quote mint means the curve trades against SOL. */
  quoteIsSol: boolean | null
}

function u64(view: DataView, offset: number) {
  return view.getBigUint64(offset, true)
}

/**
 * Decodes the stable prefix of the BondingCurve account (reserves, supply,
 * completion, creator). Later fields are read only when present, because
 * older curves have shorter accounts.
 */
export function decodeBondingCurve(data: Uint8Array): BondingCurveState | null {
  if (data.length < 49) return null
  for (let index = 0; index < DISCRIMINATOR.length; index += 1) if (data[index] !== DISCRIMINATOR[index]) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const creator = data.length >= 81 ? data.slice(49, 81) : null
  let quoteIsSol: boolean | null = null
  if (data.length >= 115) quoteIsSol = data.slice(83, 115).every((byte) => byte === 0)
  return {
    virtualTokenReserves: u64(view, 8),
    virtualQuoteReserves: u64(view, 16),
    realTokenReserves: u64(view, 24),
    realQuoteReserves: u64(view, 32),
    tokenTotalSupply: u64(view, 40),
    complete: data[48] === 1,
    creator,
    quoteIsSol,
  }
}

/** SOL per whole token implied by the curve's virtual reserves (SOL-quoted curves only). */
export function curvePriceInSol(state: BondingCurveState, tokenDecimals = 6): number | null {
  if (state.virtualTokenReserves === 0n || state.quoteIsSol === false) return null
  const lamportsPerToken = (Number(state.virtualQuoteReserves) / Number(state.virtualTokenReserves)) * 10 ** tokenDecimals
  return lamportsPerToken / 1e9
}

export function pumpTradingLink(mint: string) {
  return `https://pump.fun/coin/${mint}`
}
