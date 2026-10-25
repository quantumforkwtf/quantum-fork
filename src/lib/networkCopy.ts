import { CLIENT_CONFIG, useServerStatus } from '../config'

const MAINNET = CLIENT_CONFIG.network === 'mainnet-beta'
const REGISTRATION_ON = MAINNET ? CLIENT_CONFIG.flags.mainnetDeployments : CLIENT_CONFIG.flags.testnetDeployments

/**
 * Wording that depends on the network this build targets, so nothing mentions devnet or test
 * tokens once the site runs on mainnet. What is actually possible still comes from /api/status.
 */
export const NET = {
  mainnet: MAINNET,
  /** What registration burns, mid-sentence: "Burn {burn}." */
  burn: MAINNET ? '$QFORK' : 'devnet test QFORK',
  /** Sentence-initial form of `burn`. */
  Burn: MAINNET ? '$QFORK' : 'Devnet test QFORK',
  /** Unit after an amount: "1,000 {unit}". */
  unit: MAINNET ? 'QFORK' : 'test QFORK',
  /** Appended to sentences about burning; empty on mainnet. */
  noValue: MAINNET ? '' : ' Test tokens have no value.',
  /** Status label for the registration step. */
  registration: REGISTRATION_ON ? (MAINNET ? 'MAINNET' : CLIENT_CONFIG.network.toUpperCase()) : 'NOT OPEN YET',
}

/** The registration label as the server reports it, so it reads MAINNET once either Base or Solana mainnet registration opens. */
export function useRegistrationLabel() {
  const server = useServerStatus()
  if (server.state !== 'ok') return NET.registration
  const { base, tiers } = server.status
  return (base?.network === 'base' && base.registration.available) || tiers.mainnet.available ? 'MAINNET' : NET.registration
}
