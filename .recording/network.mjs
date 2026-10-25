// A registered descendant, as the server knows it: console, tokens, developer kit and public page.
// Uses ID=dep_… if given, otherwise the newest descendant from /api/descendants. Registering one needs a wallet,
// so this script only reads; run the lab with a devnet wallet first.
// BASE=https://quantumfork.wtf node .recording/network.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const failures = []
const notes = []
const check = (ok, label, detail = '') => {
  if (ok) notes.push(`ok   ${label}`)
  else failures.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

const json = async (path) => {
  const response = await fetch(`${BASE}${path}`)
  return { status: response.status, body: await response.json().catch(() => null) }
}

let id = process.env.ID
if (!id) {
  const list = await json('/api/descendants')
  const items = list.body?.descendants ?? list.body?.items ?? []
  id = items[0]?.id
}
if (!id) {
  console.log('No registered descendant on this server yet. Register one in the lab with a devnet wallet, then rerun.')
  process.exit(0)
}

const remote = await json(`/api/deployments?id=${id}`)
check(remote.status === 200 && remote.body?.deployment?.state === 'REGISTERED', `server says ${id} is REGISTERED`, `${remote.status} ${remote.body?.deployment?.state}`)
check(remote.body?.receipt?.verificationStatus === 'VERIFIED' && remote.body?.receipt?.verifier === 'server', 'its burn receipt was verified by the server')
const tokens = remote.body?.tokens ?? []
const code = remote.body?.deployment?.descendantId

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const shots = new URL('./shots/network/', import.meta.url).pathname
rmSync(shots, { recursive: true, force: true })
mkdirSync(shots, { recursive: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
await context.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
const page = await context.newPage()
const errors = []
page.on('console', (message) => message.type() === 'error' && !message.text().startsWith('Failed to load resource') && errors.push(message.text()))
page.on('pageerror', (error) => errors.push(error.message))
const text = () => page.locator('body').innerText()

await page.goto(`${BASE}/network/${id}`, { waitUntil: 'networkidle' })
await page.locator('.nc-metrics').waitFor({ timeout: 15000 })
const overview = await text()
check(overview.includes(code), 'console shows the descendant code', code)
check(/Registered/.test(overview) && /Running chain/.test(overview) && /Not built/.test(overview), 'metrics: registered, running chain not built')
check(!/simulat|ONLINE|validators? online|genesis block/i.test(overview), 'console claims no running network')
const launchButtons = await page.getByRole('button', { name: /Launch a token/ }).all()
check(launchButtons.length > 0 && (await Promise.all(launchButtons.map((button) => button.isDisabled()))).every(Boolean), 'every launch button is disabled without the owner wallet', `${launchButtons.length} buttons`)
await page.screenshot({ path: `${shots}01-overview.png` })

await page.goto(`${BASE}/network/${id}/tokens`, { waitUntil: 'networkidle' })
const tokenText = await text()
if (tokens.length) for (const token of tokens) check(tokenText.includes(`$${token.symbol}`), `token $${token.symbol} is listed`)
else check(/No tokens|not launched|Launch/i.test(tokenText), 'tokens tab explains there are none yet')
await page.screenshot({ path: `${shots}02-tokens.png` })

await page.goto(`${BASE}/network/${id}/developers`, { waitUntil: 'networkidle' })
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download descendant.json' }).click()])
const manifest = JSON.parse(readFileSync(await download.path(), 'utf8'))
check(manifest.spec === 'qfork.descendant/v1' && manifest.status === 'REGISTERED' && manifest.code === code && manifest.profile.endsWith(`/species/${id}`), 'descendant.json is the registered record', JSON.stringify(manifest).slice(0, 160))
check(!/secret|private|seed phrase|mnemonic/i.test(JSON.stringify(manifest)), 'descendant.json holds no key material')
await page.screenshot({ path: `${shots}03-developers.png` })

await page.goto(`${BASE}/species/${id}`, { waitUntil: 'networkidle' })
const report = await text()
check(report.includes(code) && /Running chain/.test(report), 'public page shows the descendant and that no chain runs it')
check(!/simulat/i.test(report), 'public page has no simulated wording')
await page.screenshot({ path: `${shots}04-public.png` })

check(errors.length === 0, 'no console errors', errors.join(' | '))
await browser.close()
console.log(notes.join('\n'))
console.log(failures.length ? `\n${failures.join('\n')}\n\n${failures.length} failed, ${notes.length} passed` : `\nall ${notes.length} checks passed`)
process.exit(failures.length ? 1 : 0)
