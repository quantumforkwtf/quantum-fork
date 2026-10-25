import { ed25519 } from '@noble/curves/ed25519'
import { associatedTokenAddress, base58Encode } from '../../src/protocol/address.js'
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../../src/protocol/verifyBurn.js'
import {
  compileLegacyMessage,
  createAssociatedTokenAccountIdempotentInstruction,
  memoInstruction,
  mintToCheckedInstruction,
  toBase64,
  transferInstruction,
} from '../../src/lib/solana/tx.js'
import { type Context, HttpError } from './http.js'
import { rpcClient, rpcFailure } from './rpc.js'
import { keys } from './store.js'

export const FAUCET_QFORK = 1_000_000
const SOL_TOP_UP = 100_000_000n
const SOL_THRESHOLD = 50_000_000n
const AUTHORITY_RESERVE = 500_000_000n
const WALLET_COOLDOWN = 86_400
const IP_DAILY_LIMIT = 3

export function faucetAvailability(context: Context): { available: boolean; reason: string; amount: number } {
  const { config, faucetKey } = context.env
  const amount = FAUCET_QFORK
  if (config.network === 'mainnet-beta') return { available: false, reason: 'There is no faucet on mainnet.', amount }
  if (!config.mint) return { available: false, reason: 'No devnet test mint is configured.', amount }
  if (!faucetKey) return { available: false, reason: 'The faucet authority is not configured on this server.', amount }
  if (!context.store.persistent) return { available: false, reason: 'Server storage is not configured, so the faucet cannot rate-limit.', amount }
  return { available: true, reason: `Sends ${amount.toLocaleString('en-US')} devnet test QFORK, plus devnet SOL for fees if you are low. Test tokens have no value.`, amount }
}

/** Mints devnet test QFORK to a wallet, signed by the server-held devnet mint authority. */
export async function dripFaucet(context: Context, wallet: string) {
  const availability = faucetAvailability(context)
  if (!availability.available) throw new HttpError(403, 'FAUCET_UNAVAILABLE', availability.reason)
  const secret = context.env.faucetKey as Uint8Array
  const mint = context.env.config.mint as string
  const authority = base58Encode(ed25519.getPublicKey(secret.slice(0, 32)))

  const claimed = await context.store.set(keys.faucet(`w:${wallet}`), new Date().toISOString(), { nx: true, ttlSeconds: WALLET_COOLDOWN })
  if (!claimed) throw new HttpError(429, 'FAUCET_COOLDOWN', 'This wallet already received test QFORK in the last 24 hours.')
  const day = Math.floor(Date.now() / 86_400_000)
  const ipCount = await context.store.incr(keys.faucet(`ip:${context.ip}:${day}`))
  if (ipCount === 1) await context.store.expire(keys.faucet(`ip:${context.ip}:${day}`), 90_000)
  if (ipCount > IP_DAILY_LIMIT) {
    await context.store.del(keys.faucet(`w:${wallet}`))
    throw new HttpError(429, 'FAUCET_COOLDOWN', 'This network already claimed test QFORK several times today.')
  }

  const rpc = rpcClient(context.env.config.rpcUrl, 10_000)
  try {
    const account = (await rpc.getParsedAccount(mint)).value
    if (!account || (account.owner !== TOKEN_PROGRAM && account.owner !== TOKEN_2022_PROGRAM) || Array.isArray(account.data) || account.data.parsed?.type !== 'mint') {
      throw new HttpError(500, 'MINT_INVALID', 'The configured test mint is not a token mint on this network.')
    }
    const info = account.data.parsed.info as { decimals: number; mintAuthority?: string }
    if (info.mintAuthority !== authority) throw new HttpError(500, 'FAUCET_MISCONFIGURED', 'The faucet key is not the test mint’s authority.')
    const decimals = Number(info.decimals)
    const tokenProgram = account.owner
    const [walletLamports, authorityLamports, latest] = await Promise.all([rpc.getBalance(wallet), rpc.getBalance(authority), rpc.getLatestBlockhash()])

    const destination = associatedTokenAddress(wallet, mint, tokenProgram)
    const instructions = [
      createAssociatedTokenAccountIdempotentInstruction({ payer: authority, account: destination, owner: wallet, mint, tokenProgram }),
      mintToCheckedInstruction({ tokenProgram, mint, destination, authority, amount: BigInt(FAUCET_QFORK) * 10n ** BigInt(decimals), decimals }),
    ]
    const topUp = walletLamports < SOL_THRESHOLD && authorityLamports > AUTHORITY_RESERVE + SOL_TOP_UP
    if (topUp) instructions.push(transferInstruction(authority, wallet, SOL_TOP_UP))
    instructions.push(memoInstruction('qfork:v1:faucet', authority))

    const message = compileLegacyMessage(authority, instructions, latest.blockhash)
    const signature = ed25519.sign(message, secret.slice(0, 32))
    const transaction = Uint8Array.from([1, ...signature, ...message])
    const sent = await rpc.sendTransaction(toBase64(transaction))
    context.log.info('faucet drip', { amount: FAUCET_QFORK, topUp })
    return { signature: sent, amount: FAUCET_QFORK, solTopUp: topUp ? Number(SOL_TOP_UP) / 1e9 : 0, lastValidBlockHeight: latest.lastValidBlockHeight }
  } catch (error) {
    await context.store.del(keys.faucet(`w:${wallet}`)).catch(() => undefined)
    if (error instanceof HttpError) throw error
    throw rpcFailure(error)
  }
}
