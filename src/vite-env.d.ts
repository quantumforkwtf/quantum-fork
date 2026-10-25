/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_NETWORK?: string
  readonly VITE_SOLANA_RPC_URL?: string
  readonly VITE_QFORK_MINT?: string
  readonly VITE_TOKEN_STATUS?: string
  readonly VITE_PUMPFUN_URL?: string
  readonly VITE_SITE_URL?: string
  readonly VITE_ENABLE_REAL_BURNS?: string
  readonly VITE_ENABLE_TESTNET_DEPLOYMENTS?: string
  readonly VITE_ENABLE_MAINNET_DEPLOYMENTS?: string
  readonly VITE_ENABLE_PUMPFUN_DATA?: string
  readonly VITE_ENABLE_SCANNER?: string
  readonly VITE_ENABLE_EXPERIMENTAL_PQ?: string
}

declare const __BUILD_SHA__: string
declare const __BUILD_TIME__: string

interface ImportMeta {
  readonly env: ImportMetaEnv
}
