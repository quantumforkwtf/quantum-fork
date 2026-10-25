import { CLIENT_CONFIG, configMismatch, useServerStatus } from '../config'
import type { RuntimeCapabilities } from '../protocol/blueprintCompiler'

/** What the server says the running deployment can do. Offline or mismatched means nothing beyond simulation. */
export function useRuntime(): RuntimeCapabilities {
  const server = useServerStatus()
  if (server.state !== 'ok' || configMismatch(server.status)) return { devnetBurn: false, mainnetBurn: false }
  const mainnet = CLIENT_CONFIG.network === 'mainnet-beta'
  return {
    devnetBurn: !mainnet && server.status.tiers.testnet.available,
    mainnetBurn: mainnet && server.status.tiers.mainnet.available,
  }
}

const ASSEMBLED_KEY = 'qfork.blueprints.assembled'

/** The assembly moment plays once per browser. */
export function assemblySeen() {
  try {
    return window.localStorage.getItem(ASSEMBLED_KEY) === '1'
  } catch {
    return true
  }
}

export function markAssemblySeen() {
  try {
    window.localStorage.setItem(ASSEMBLED_KEY, '1')
  } catch {
    // Without storage the assembly simply plays again.
  }
}
