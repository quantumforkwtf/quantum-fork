import { isBase58Address, type PublicKeyLike } from './address.js'

export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet'
export type TokenStatus = 'PRELAUNCH' | 'LIVE'

export interface Flags {
  realBurns: boolean
  testnetDeployments: boolean
  mainnetDeployments: boolean
  pumpfunData: boolean
  scanner: boolean
  experimentalPq: boolean
  pumpfunLaunch: boolean
}

export interface PublicConfig {
  network: SolanaNetwork
  rpcUrl: string
  mint: PublicKeyLike | null
  tokenStatus: TokenStatus
  pumpfunUrl: string | null
  siteUrl: string
  flags: Flags
}

export interface ConfigIssue {
  key: string
  level: 'error' | 'warning'
  message: string
}

export const PUBLIC_RPC: Record<SolanaNetwork, string> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
}

export const DEFAULT_SITE_URL = 'https://quantumfork.wtf'

type Env = Record<string, string | boolean | undefined>

function flag(env: Env, key: string) {
  const value = env[key]
  return value === true || value === 'true' || value === '1'
}

function text(env: Env, key: string) {
  const value = env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Resolves configuration from an environment map. `prefix` is `VITE_` in the
 * browser and empty on the server. Any inconsistency resolves to the safer
 * setting and is reported as an issue rather than throwing.
 */
export function resolveConfig(env: Env, prefix = ''): { config: PublicConfig; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = []
  const key = (name: string) => `${prefix}${name}`

  const rawNetwork = text(env, key('SOLANA_NETWORK')) ?? 'devnet'
  let network: SolanaNetwork = 'devnet'
  if (rawNetwork === 'mainnet-beta' || rawNetwork === 'mainnet') network = 'mainnet-beta'
  else if (rawNetwork === 'devnet' || rawNetwork === 'testnet') network = rawNetwork
  else issues.push({ key: key('SOLANA_NETWORK'), level: 'error', message: `Unknown network "${rawNetwork}". Falling back to devnet.` })

  let rpcUrl = text(env, key('SOLANA_RPC_URL')) ?? PUBLIC_RPC[network]
  if (!/^https:\/\//.test(rpcUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(rpcUrl)) {
    issues.push({ key: key('SOLANA_RPC_URL'), level: 'error', message: 'RPC URL must use https. Falling back to the public endpoint.' })
    rpcUrl = PUBLIC_RPC[network]
  }
  if (rpcUrl === PUBLIC_RPC[network] && network === 'mainnet-beta') {
    issues.push({ key: key('SOLANA_RPC_URL'), level: 'warning', message: 'Using the rate-limited public mainnet RPC. Configure a dedicated endpoint before launch.' })
  }

  const rawMint = text(env, key('QFORK_MINT'))
  let mint: string | null = null
  if (rawMint) {
    if (isBase58Address(rawMint)) mint = rawMint
    else issues.push({ key: key('QFORK_MINT'), level: 'error', message: 'QFORK mint is not a valid base58 address. Token features are disabled.' })
  }

  let tokenStatus: TokenStatus = text(env, key('TOKEN_STATUS')) === 'LIVE' ? 'LIVE' : 'PRELAUNCH'
  if (tokenStatus === 'LIVE' && !mint) {
    issues.push({ key: key('TOKEN_STATUS'), level: 'error', message: 'TOKEN_STATUS is LIVE but no valid QFORK mint is configured. Treating the token as PRELAUNCH.' })
    tokenStatus = 'PRELAUNCH'
  }

  const rawPump = text(env, key('PUMPFUN_URL'))
  let pumpfunUrl: string | null = null
  if (rawPump) {
    if (/^https:\/\/(www\.)?pump\.fun\//.test(rawPump)) pumpfunUrl = rawPump
    else issues.push({ key: key('PUMPFUN_URL'), level: 'error', message: 'PUMPFUN_URL must be an https://pump.fun/ link.' })
  } else if (mint && tokenStatus === 'LIVE' && network === 'mainnet-beta') {
    pumpfunUrl = `https://pump.fun/coin/${mint}`
  }

  const siteUrl = (text(env, key('SITE_URL')) ?? DEFAULT_SITE_URL).replace(/\/$/, '')

  const flags: Flags = {
    realBurns: flag(env, key('ENABLE_REAL_BURNS')),
    testnetDeployments: flag(env, key('ENABLE_TESTNET_DEPLOYMENTS')),
    mainnetDeployments: flag(env, key('ENABLE_MAINNET_DEPLOYMENTS')),
    pumpfunData: flag(env, key('ENABLE_PUMPFUN_DATA')),
    scanner: text(env, key('ENABLE_SCANNER')) !== 'false',
    experimentalPq: flag(env, key('ENABLE_EXPERIMENTAL_PQ')),
    pumpfunLaunch: flag(env, key('ENABLE_PUMPFUN_LAUNCH')),
  }

  if (flags.realBurns && !mint) {
    issues.push({ key: key('ENABLE_REAL_BURNS'), level: 'warning', message: 'Real burns need a QFORK mint for this network. Burns stay disabled.' })
    flags.realBurns = false
  }
  if (flags.realBurns && network === 'mainnet-beta' && tokenStatus !== 'LIVE') {
    issues.push({ key: key('ENABLE_REAL_BURNS'), level: 'warning', message: 'Mainnet burns require TOKEN_STATUS=LIVE. Burns stay disabled.' })
    flags.realBurns = false
  }
  if (flags.mainnetDeployments && network !== 'mainnet-beta') {
    issues.push({ key: key('ENABLE_MAINNET_DEPLOYMENTS'), level: 'warning', message: 'Mainnet registrations need SOLANA_NETWORK=mainnet-beta. They stay disabled.' })
    flags.mainnetDeployments = false
  }
  if (flags.testnetDeployments && network === 'mainnet-beta') {
    issues.push({ key: key('ENABLE_TESTNET_DEPLOYMENTS'), level: 'error', message: 'Devnet registration requires a devnet or testnet network. It stays disabled on mainnet.' })
    flags.testnetDeployments = false
  }
  if (flags.pumpfunData && network !== 'mainnet-beta') {
    issues.push({ key: key('ENABLE_PUMPFUN_DATA'), level: 'warning', message: 'Pump.fun market data exists only on mainnet. Disabled on this network.' })
    flags.pumpfunData = false
  }

  return { config: { network, rpcUrl, mint, tokenStatus, pumpfunUrl, siteUrl, flags }, issues }
}

/** Whether a tier may register a descendant with a real, server-verified burn under this configuration. */
export function tierAvailability(config: PublicConfig, tier: 'testnet' | 'mainnet'): { available: boolean; reason: string } {
  if (tier === 'mainnet') {
    if (config.network !== 'mainnet-beta') return { available: false, reason: 'Mainnet registration opens when $QFORK launches. This site runs on devnet.' }
    if (!config.flags.mainnetDeployments) return { available: false, reason: 'Mainnet registration is switched off (ENABLE_MAINNET_DEPLOYMENTS).' }
    if (!config.flags.realBurns || !config.mint) return { available: false, reason: 'No live $QFORK mint is configured, or burns are switched off.' }
    return { available: true, reason: 'Burns real $QFORK, verified on-chain by the server.' }
  }
  if (config.network === 'mainnet-beta') return { available: false, reason: 'Devnet registration runs on devnet. This site is configured for mainnet.' }
  if (!config.flags.testnetDeployments) return { available: false, reason: 'Devnet registration is switched off (ENABLE_TESTNET_DEPLOYMENTS).' }
  if (!config.flags.realBurns || !config.mint) return { available: false, reason: 'No devnet test mint is configured, or burns are switched off.' }
  return { available: true, reason: 'Burns devnet test QFORK, verified on-chain by the server. Test tokens have no value.' }
}
