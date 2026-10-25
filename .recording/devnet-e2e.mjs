// Real devnet end-to-end against the deployed API: faucet, deployment, BurnChecked + memo, server verification.
// The test wallet is generated in memory and never written or printed.
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token'
import { randomUUID } from 'node:crypto'

const BASE = process.env.BASE ?? 'https://quantumfork.wtf'
const RPC = 'https://api.devnet.solana.com'
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const conn = new Connection(RPC, 'confirmed')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (ok, label, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` · ${detail}` : ''}`)
}
async function api(path, body, headers = {}) {
  const res = await fetch(BASE + path, body ? { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) } : {})
  let data = null
  try { data = await res.json() } catch { /* empty */ }
  return { status: res.status, data }
}

const status = (await api('/api/status')).data
check(status.network === 'devnet' && status.storage.persistent && status.tiers.testnet.available && status.faucet.available, 'server: devnet, persistent storage, registration and faucet available')
const mint = new PublicKey(status.mint)

const wallet = Keypair.generate()
const owner = wallet.publicKey
console.log(`     test wallet ${owner.toBase58()}`)

/* faucet */
const drip = await api('/api/faucet', { wallet: owner.toBase58() })
check(drip.status === 200, 'faucet: claim accepted', `HTTP ${drip.status}${drip.data?.error ? ` ${drip.data.error.code}` : ''}`)
const again = await api('/api/faucet', { wallet: owner.toBase58() })
check(again.status >= 400, 'faucet: second claim for the same wallet refused', `HTTP ${again.status} ${again.data?.error?.code ?? ''}`)

const ata = getAssociatedTokenAddressSync(mint, owner)
let held = 0n
for (let i = 0; i < 40 && held === 0n; i++) {
  await sleep(1500)
  held = BigInt((await conn.getTokenAccountBalance(ata).catch(() => ({ value: { amount: '0' } }))).value.amount)
}
const sol = await conn.getBalance(owner)
const info = await getMint(conn, mint)
check(held > 0n, 'faucet: test QFORK arrived on-chain', `${Number(held) / 10 ** info.decimals} QFORK, ${sol / 1e9} SOL`)

/* deployment */
const config = {
  ancestor: 'solana', profile: 'hybrid', modules: [],
  network: { name: 'E2E HYBRID', symbol: 'QE2E', networkId: `qf-e2e-${Date.now().toString(36)}` },
  validators: { count: 32, hardware: 'standard' }, rpc: { access: 'public' },
  economics: { baseFeeLamports: 5000, burnPct: 50 }, privacy: 'public', recovery: 'pq-commitment', tier: 'testnet',
}
const key = randomUUID()
const created = await api('/api/deployments', { config }, { 'idempotency-key': key })
check(created.status === 201, 'deployment: created', `HTTP ${created.status} ${created.data?.error?.code ?? ''}`)
const dep = created.data.deployment
console.log(`     ${dep.id} · ${dep.descendantId} · requires ${dep.burn.required} QFORK · memo ${dep.burn.memo}`)
const replayCreate = await api('/api/deployments', { config }, { 'idempotency-key': key })
check(replayCreate.data?.deployment?.id === dep.id, 'deployment: same idempotency key returns the same deployment')

/* burn */
const amountRaw = BigInt(dep.burn.required) * 10n ** BigInt(info.decimals)
check(held >= amountRaw, 'wallet holds enough for the burn')
const latest = await conn.getLatestBlockhash('confirmed')
const tx = new Transaction({ feePayer: owner, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 }),
  createBurnCheckedInstruction(ata, mint, owner, amountRaw, info.decimals),
  new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: owner, isSigner: true, isWritable: false }], data: Buffer.from(dep.burn.memo) }),
)
tx.sign(wallet)
const signature = await conn.sendRawTransaction(tx.serialize())
console.log(`     burn ${signature}`)
await conn.confirmTransaction({ signature, ...latest }, 'confirmed')
check(true, 'burn: confirmed on devnet')

/* server verification */
let outcome
const started = Date.now()
for (;;) {
  outcome = await api('/api/burns', { deploymentId: dep.id, signature })
  if (outcome.status !== 202 || Date.now() - started > 120_000) break
  await sleep(3000)
}
check(outcome.status === 200 && outcome.data.status === 'VERIFIED', 'server: burn verified at finalized commitment', `HTTP ${outcome.status} ${outcome.data?.status ?? ''} ${outcome.data?.code ?? outcome.data?.error?.code ?? ''} after ${Math.round((Date.now() - started) / 1000)}s`)
const receipt = outcome.data?.receipt
check(receipt?.wallet === owner.toBase58() && receipt?.amountRaw === amountRaw.toString() && receipt?.mint === mint.toBase58(), 'receipt: wallet, amount and mint read from the chain match')
check(outcome.data?.deployment?.state === 'REGISTERED', 'deployment: REGISTERED', outcome.data?.deployment?.state)

/* replays */
const resubmit = await api('/api/burns', { deploymentId: dep.id, signature })
check(resubmit.status === 200 && resubmit.data.status === 'VERIFIED', 'replay: same signature, same deployment is idempotent')
const other = await api('/api/deployments', { config: { ...config, network: { ...config.network, networkId: `${config.network.networkId}-b` } } }, { 'idempotency-key': randomUUID() })
const stolen = await api('/api/burns', { deploymentId: other.data.deployment.id, signature })
check(stolen.status >= 400 && stolen.data?.status !== 'VERIFIED', 'replay: same signature cannot register a second deployment', `HTTP ${stolen.status} ${stolen.data?.code ?? stolen.data?.error?.code ?? ''}`)

/* public surfaces */
const lookup = await api(`/api/burns?signature=${signature}`)
check(lookup.status === 200 && lookup.data.receipt.signature === signature, 'public receipt lookup by signature')
const read = await api(`/api/deployments?id=${dep.id}`)
check(read.status === 200 && read.data.deployment.state === 'REGISTERED', 'deployment readable after a fresh request (persistent storage)')
const listed = await api('/api/descendants')
check(listed.data?.persistent && JSON.stringify(listed.data.descendants).includes(dep.id), 'descendant appears in the public registry')

console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'} · ${dep.descendantId} · ${dep.id}`)
console.log(`explorer https://explorer.solana.com/tx/${signature}?cluster=devnet`)
process.exit(failures ? 1 : 0)
