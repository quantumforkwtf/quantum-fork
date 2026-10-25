#!/usr/bin/env node
// Launch-day checks for $QFORK on Base. Read-only: no keys, no transactions.
//
//   node scripts/launch-preflight.mjs <token>                        checks the token on Base mainnet
//   node scripts/launch-preflight.mjs <token> --site https://quantumfork.wtf   also checks the deployed site
//   --rpc <url>   Base mainnet RPC to check against (default: the server's BASE_RPC_URL, else mainnet.base.org)
//   --symbol <s>  expected symbol (default QFORK), for rehearsing against another Clanker token

import { concatHex, createPublicClient, encodeFunctionData, erc20Abi, getAddress, http, isAddress, parseAbi, toHex } from 'viem'
import { base } from 'viem/chains'

const CLANKER_FACTORY = '0xE85A59c628F7d27878ACeB4bf3b35733630083a9'
const POOL_MANAGER = '0x498581fF718922c3f8e6A244956aF099B2652b2b'
const CLANKER_SUPPLY_RAW = 100_000_000_000n * 10n ** 18n
const FACTORY_ABI = parseAbi(['function tokenDeploymentInfo(address token) view returns ((address token, address hook, address locker, address[] extensions))'])
const BURN_ABI = parseAbi(['function burn(uint256 value)'])

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const tokenArg = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'))
if (!tokenArg || !isAddress(tokenArg)) {
  console.error('Usage: node scripts/launch-preflight.mjs <QFORK Base token address> [--site https://quantumfork.wtf] [--rpc <url>] [--symbol QFORK]')
  process.exit(2)
}
const token = getAddress(tokenArg)
const rpc = option('--rpc') ?? process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'
const site = option('--site')?.replace(/\/$/, '')
const symbolWanted = option('--symbol') ?? 'QFORK'
const client = createPublicClient({ chain: base, transport: http(rpc, { retryCount: 3 }) })

let failures = 0
let clanker = false
const pass = (label, detail = '') => console.log(`  PASS  ${label}${detail ? `: ${detail}` : ''}`)
const warn = (label, detail = '') => console.log(`  WARN  ${label}${detail ? `: ${detail}` : ''}`)
const fail = (label, detail = '') => {
  failures += 1
  console.log(`  FAIL  ${label}${detail ? `: ${detail}` : ''}`)
}
const check = async (label, run) => {
  try {
    await run()
  } catch (error) {
    fail(label, error?.shortMessage ?? error?.message ?? String(error))
  }
}

console.log(`\n$QFORK on Base: ${token}`)
console.log(`RPC: ${new URL(rpc).host}\n\nToken`)

await check('Base mainnet RPC', async () => {
  const chainId = await client.getChainId()
  if (chainId !== 8453) return fail('Base mainnet RPC', `chain id ${chainId}, expected 8453`)
  const finalized = await client.getBlock({ blockTag: 'finalized' })
  const latest = await client.getBlockNumber()
  pass('Base mainnet RPC', `chain 8453, finalized block ${finalized.number} (${latest - finalized.number} behind head)`)
})

await check('Contract exists', async () => {
  const code = await client.getCode({ address: token })
  if (!code || code === '0x') return fail('Contract exists', 'no code at this address on Base mainnet')
  pass('Contract exists')
})

await check('Created by Clanker v4', async () => {
  const info = await client.readContract({ address: CLANKER_FACTORY, abi: FACTORY_ABI, functionName: 'tokenDeploymentInfo', args: [token] })
  if (getAddress(info.token) !== token) return fail('Created by Clanker v4', 'the Clanker v4 factory has no record of this token')
  clanker = true
  pass('Created by Clanker v4', `locker ${info.locker}`)
})

await check('Name, symbol, decimals', async () => {
  const [name, symbol, decimals] = await Promise.all(
    ['name', 'symbol', 'decimals'].map((functionName) => client.readContract({ address: token, abi: erc20Abi, functionName })),
  )
  if (decimals !== 18) return fail('Name, symbol, decimals', `decimals ${decimals}, the server expects 18`)
  if (symbol !== symbolWanted) return fail('Name, symbol, decimals', `symbol is "${symbol}" (${name}), expected "${symbolWanted}"`)
  pass('Name, symbol, decimals', `${name} ($${symbol}), 18 decimals`)
})

await check('Total supply', async () => {
  if (!clanker) return warn('Total supply', 'skipped: not a Clanker v4 token')
  const supply = await client.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' })
  if (supply > CLANKER_SUPPLY_RAW) return fail('Total supply', `${supply} is above the 100B Clanker supply the burn pricing assumes`)
  if (supply < CLANKER_SUPPLY_RAW) warn('Total supply', `${supply / 10n ** 18n} whole tokens: some supply was already burned`)
  else pass('Total supply', '100,000,000,000 (Clanker v4 standard)')
})

await check('Tagged burn accepted', async () => {
  if (!clanker) return warn('Tagged burn accepted', 'skipped: not a Clanker v4 token')
  const held = await client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [POOL_MANAGER] })
  if (held === 0n) return warn('Tagged burn accepted', 'skipped: the Uniswap v4 pool holds none of this token to simulate with')
  const tag = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const data = concatHex([encodeFunctionData({ abi: BURN_ABI, functionName: 'burn', args: [1n] }), tag])
  await client.call({ account: POOL_MANAGER, to: token, data })
  pass('Tagged burn accepted', 'burn(uint256) with a 32-byte registration tag simulates cleanly')
})

const env = [
  ['BASE_NETWORK', 'base'],
  ['QFORK_BASE_TOKEN', token],
  ['BASE_TOKEN_STATUS', 'LIVE'],
  ['ENABLE_BASE_DEPLOYMENTS', 'true'],
]

if (site) {
  console.log(`\nSite: ${site}`)
  await check('/api/status', async () => {
    const status = await (await fetch(`${site}/api/status`)).json()
    const live = status.base ?? {}
    if (live.network !== 'base') return fail('/api/status', `Base network is "${live.network}", expected "base"`)
    if (!live.token || getAddress(live.token) !== token) return fail('/api/status', `token is ${live.token}, expected ${token}`)
    if (live.tokenStatus !== 'LIVE') return fail('/api/status', `token status is ${live.tokenStatus}`)
    if (!live.registration?.available) return fail('/api/status', `registration closed: ${live.registration?.reason}`)
    if (!status.storage?.persistent) return fail('/api/status', 'storage is not persistent')
    pass('/api/status', `Base registration open${live.clankerLaunch ? ', Clanker launches on' : ''}`)
    if (status.issues?.length) warn('/api/status', `config issues: ${status.issues.map((issue) => issue.message ?? issue).join('; ')}`)
  })
  await check('/api/token', async () => {
    const body = await (await fetch(`${site}/api/token`)).json()
    const live = body.base ?? {}
    if (live.status !== 'LIVE' || !live.token || getAddress(live.token) !== token) return fail('/api/token', `Base token ${live.token} is ${live.status}`)
    if (live.error) return fail('/api/token', `the site could not read the token: ${live.error}`)
    pass('/api/token', `site reads supply ${BigInt(live.supplyRaw ?? 0) / 10n ** 18n} from chain`)
  })
}

console.log('\nVercel production env for launch')
for (const [key, value] of env) console.log(`  ${key}=${value}`)
console.log('  ENABLE_CLANKER_LAUNCH=true      optional: lets descendant owners launch their own Clanker tokens')
console.log('  BASE_RPC_URL=https://...        recommended: a dedicated Base mainnet endpoint; mainnet.base.org is rate limited')

console.log(failures ? `\n${failures} check${failures === 1 ? '' : 's'} failed. Do not switch the site over yet.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)
