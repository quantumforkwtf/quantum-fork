import { base58Decode, base58Encode, findProgramAddress } from '../../src/protocol/address.js'
import { BONDING_CURVE_SEED, curvePriceInSol, decodeBondingCurve, PUMP_PROGRAM_ID, pumpTradingLink } from '../../src/protocol/pumpfun.js'
import { rpcClient } from './rpc.js'

export interface PumpMarket {
  source: 'pump-bonding-curve'
  bondingCurve: string
  complete: boolean
  priceSol: number | null
  marketCapSol: number | null
  curveTokensRemainingRaw: string
  curveSolRaw: string
  creator: string | null
  tradingLink: string
}

/**
 * Reads market data directly from the Pump program's bonding-curve account.
 * Once the curve completes, liquidity migrates to an AMM and curve pricing no
 * longer applies; the adapter then reports `complete` with no price.
 */
export function pumpfunAdapter(rpcUrl: string) {
  const rpc = rpcClient(rpcUrl, 6000)

  const bondingCurveAddress = (mint: string) => findProgramAddress([new TextEncoder().encode(BONDING_CURVE_SEED), base58Decode(mint)], PUMP_PROGRAM_ID)[0]

  return {
    getTradingLink: (mint: string) => pumpTradingLink(mint),
    bondingCurveAddress,
    async getToken(mint: string) {
      const account = await rpc.getParsedAccount(mint)
      const value = account?.value
      if (!value || Array.isArray(value.data) || value.data.parsed?.type !== 'mint') return null
      const info = value.data.parsed.info as { decimals: number; supply: string; mintAuthority: string | null; freezeAuthority: string | null }
      return { mint, tokenProgram: value.owner, decimals: info.decimals, supplyRaw: info.supply, mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority }
    },
    async getBondingStatus(mint: string) {
      const address = bondingCurveAddress(mint)
      const account = await rpc.getRawAccount(address)
      if (!account?.value || account.value.owner !== PUMP_PROGRAM_ID) return null
      const bytes = Uint8Array.from(atob(account.value.data[0]), (char) => char.charCodeAt(0))
      const state = decodeBondingCurve(bytes)
      return state ? { address, state } : null
    },
    async getMarketData(mint: string, decimals: number): Promise<PumpMarket | null> {
      const bonding = await this.getBondingStatus(mint)
      if (!bonding) return null
      const { state, address } = bonding
      const price = state.complete ? null : curvePriceInSol(state, decimals)
      const supply = Number(state.tokenTotalSupply) / 10 ** decimals
      return {
        source: 'pump-bonding-curve',
        bondingCurve: address,
        complete: state.complete,
        priceSol: price,
        marketCapSol: price === null ? null : price * supply,
        curveTokensRemainingRaw: state.realTokenReserves.toString(),
        curveSolRaw: state.realQuoteReserves.toString(),
        creator: state.creator ? base58Encode(state.creator) : null,
        tradingLink: pumpTradingLink(mint),
      }
    },
    async getCreatorInfo(mint: string) {
      const bonding = await this.getBondingStatus(mint)
      return bonding?.state.creator ? { creator: base58Encode(bonding.state.creator) } : null
    },
  }
}
