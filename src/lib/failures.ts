export type FailureCode =
  | 'WALLET_NOT_FOUND'
  | 'WALLET_REJECTED'
  | 'WRONG_NETWORK'
  | 'INSUFFICIENT_SOL'
  | 'INSUFFICIENT_QFORK'
  | 'RPC_UNAVAILABLE'
  | 'SIMULATION_FAILED'
  | 'TX_MODIFIED'
  | 'TX_EXPIRED'
  | 'BURN_FAILED'
  | 'BURN_NOT_CREDITED'
  | 'API_UNAVAILABLE'
  | 'SCAN_FAILED'
  | 'TOKEN_FAILED'
  | 'TOKEN_NOT_RECORDED'
  | 'FAUCET_FAILED'
  | 'EVM_WALLET_NOT_FOUND'
  | 'INSUFFICIENT_ETH'
  | 'WALLET_UNSUPPORTED'
  | 'ANCHOR_FAILED'
  | 'ANCHOR_NOT_RECORDED'

export type Answer = 'NO' | 'YES' | 'NETWORK FEE ONLY' | 'CHECK EXPLORER'

export interface Failure {
  title: string
  happened: string
  fundsMoved: Answer
  qforkBurned: Answer
  retrySafe: 'YES' | 'NO' | 'AFTER FIXING'
  next: string
}

/** Every failure screen answers the same five questions. */
export const FAILURES: Record<FailureCode, Failure> = {
  WALLET_NOT_FOUND: {
    title: 'NO WALLET DETECTED',
    happened: 'No Solana wallet supporting the Wallet Standard was found in this browser.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Install or unlock a Solana wallet (Phantom, Solflare, Backpack) and reload.',
  },
  WALLET_REJECTED: {
    title: 'WALLET REJECTED',
    happened: 'The request was declined in your wallet. Nothing was signed.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Review the transaction again and approve it in your wallet when ready.',
  },
  WRONG_NETWORK: {
    title: 'WRONG NETWORK',
    happened: 'Your wallet account does not support the network this site is configured for.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'AFTER FIXING',
    next: 'Switch your wallet to the network shown in the header, then reconnect.',
  },
  INSUFFICIENT_SOL: {
    title: 'INSUFFICIENT SOL',
    happened: 'The wallet cannot pay the network fee for this transaction.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'AFTER FIXING',
    next: 'Add a small amount of SOL to the connected wallet to cover the fee.',
  },
  EVM_WALLET_NOT_FOUND: {
    title: 'NO BASE WALLET DETECTED',
    happened: 'No Ethereum wallet announced itself in this browser.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Install or unlock an Ethereum wallet that supports Base (Coinbase Wallet, MetaMask, Rabby) and reload.',
  },
  INSUFFICIENT_ETH: {
    title: 'INSUFFICIENT ETH',
    happened: 'The wallet cannot pay the Base gas fee for this transaction.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'AFTER FIXING',
    next: 'Add a small amount of ETH on Base to the connected wallet to cover gas.',
  },
  WALLET_UNSUPPORTED: {
    title: 'WALLET NOT SUPPORTED',
    happened: 'The connected account is a smart-contract wallet. Its burn would be sent through another contract, which the server cannot bind to this deployment.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'AFTER FIXING',
    next: 'Connect a regular wallet account (an EOA) to burn on Base.',
  },
  INSUFFICIENT_QFORK: {
    title: 'INSUFFICIENT QFORK',
    happened: 'The wallet does not hold enough QFORK in a single token account for this burn.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'AFTER FIXING',
    next: 'Acquire the required QFORK, or choose fewer modules to lower the requirement.',
  },
  RPC_UNAVAILABLE: {
    title: 'RPC UNAVAILABLE',
    happened: 'The Solana RPC endpoint did not respond.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Wait a moment and retry. If a transaction was already sent, its status is checked on retry.',
  },
  SIMULATION_FAILED: {
    title: 'DRY RUN FAILED',
    happened: 'The network rejected a dry run of the transaction, so it was never sent.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'AFTER FIXING',
    next: 'Read the dry-run log below. Usually the balance changed or the token account is frozen.',
  },
  TX_MODIFIED: {
    title: 'TRANSACTION MODIFIED',
    happened: 'Your wallet changed the transaction while signing. It was not sent, because the protocol could not verify the altered version.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Disable transaction-modifying features in your wallet, or try a different wallet.',
  },
  TX_EXPIRED: {
    title: 'TRANSACTION EXPIRED',
    happened: 'The transaction did not land before its blockhash expired.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Retry. A fresh transaction will be built and reviewed again.',
  },
  BURN_FAILED: {
    title: 'BURN FAILED',
    happened: 'The burn transaction failed on-chain.',
    fundsMoved: 'NETWORK FEE ONLY',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Retry the burn. No deployment was granted for the failed attempt.',
  },
  BURN_NOT_CREDITED: {
    title: 'BURN NOT CREDITED',
    happened: 'A transaction landed, but it did not match the burn this deployment requires, so it cannot be credited.',
    fundsMoved: 'CHECK EXPLORER',
    qforkBurned: 'CHECK EXPLORER',
    retrySafe: 'NO',
    next: 'Open the transaction in the explorer. Do not resend it. Keep the correlation id below if you need support.',
  },
  API_UNAVAILABLE: {
    title: 'PROTOCOL SERVER UNAVAILABLE',
    happened: 'The Quantum Fork API could not be reached.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Retry shortly. If you already sent a burn, verification resumes automatically when the server returns.',
  },
  SCAN_FAILED: {
    title: 'SCAN FAILED',
    happened: 'The ancestor analysis could not be loaded.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Reload the scanner.',
  },
  TOKEN_FAILED: {
    title: 'TOKEN NOT CREATED',
    happened: 'The token creation transaction did not succeed. No token exists.',
    fundsMoved: 'NETWORK FEE ONLY',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Start the launch again. A fresh mint address is used each time.',
  },
  TOKEN_NOT_RECORDED: {
    title: 'TOKEN CREATED, NOT RECORDED',
    happened: 'The token exists on-chain, but the server could not verify it against this descendant.',
    fundsMoved: 'CHECK EXPLORER',
    qforkBurned: 'NO',
    retrySafe: 'NO',
    next: 'The token is yours either way. Open it in the explorer; verification can be retried with the same signature.',
  },
  ANCHOR_FAILED: {
    title: 'ANCHOR NOT SENT',
    happened: 'The registry transaction would fail or could not be sent. Nothing was registered.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'AFTER FIXING',
    next: 'Read the reason above. A configuration can be anchored once per wallet; publish it again if it changed.',
  },
  ANCHOR_NOT_RECORDED: {
    title: 'ANCHORED, NOT YET RECORDED',
    happened: 'The registry transaction was sent, but the server has not confirmed it yet.',
    fundsMoved: 'NETWORK FEE ONLY',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'The on-chain record exists if the transaction succeeded. Verification can be retried with the same transaction hash.',
  },
  FAUCET_FAILED: {
    title: 'FAUCET UNAVAILABLE',
    happened: 'The devnet faucet could not send test QFORK.',
    fundsMoved: 'NO',
    qforkBurned: 'NO',
    retrySafe: 'YES',
    next: 'Wait and retry. Each wallet can claim once a day.',
  },
}

export class FlowError extends Error {
  constructor(
    readonly code: FailureCode,
    readonly detail?: string,
    readonly extra: { signature?: string; correlationId?: string | null; logs?: string[] } = {},
  ) {
    super(detail ?? FAILURES[code].happened)
    this.name = 'FlowError'
  }
}

export function isUserRejection(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: number }).code
  const message = String((error as { message?: string }).message ?? '')
  return code === 4001 || /reject|denied|declined|cancel/i.test(message)
}
