// The Clanker launch dialog for a Base descendant, up to the review screen. Nothing is signed.
// Fixture: a registered Base descendant and a prepared launch, made by the real server code against a mocked chain.
// The wallet is a fake EIP-6963 provider that answers reads only and refuses to send.
// node .recording/base-clanker.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/clanker.json', import.meta.url), 'utf8'))
const id = fixture.remote.deployment.id
const shots = new URL('./shots/clanker/', import.meta.url).pathname
mkdirSync(shots, { recursive: true })

const failures = []
const notes = []
const check = (ok, label, detail = '') => (ok ? notes.push(`ok   ${label}`) : failures.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.addInitScript(({ wallet }) => {
  window.localStorage.setItem('qfork.tour.v1', 'skipped')
  window.localStorage.setItem('qfork.evm.wallet', 'test.fake')
  window.__sent = []
  const provider = {
    async request({ method, params }) {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet]
      if (method === 'eth_chainId') return '0x14a34'
      if (method === 'eth_getBalance') return '0x2386f26fc10000'
      if (method === 'eth_gasPrice') return '0x3b9aca00'
      if (method === 'eth_estimateGas') return '0x7a120'
      if (method === 'eth_sendTransaction') {
        window.__sent.push(params)
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      }
      throw new Error(`unexpected ${method}`)
    },
    on() {},
    removeListener() {},
  }
  const announce = () =>
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: 'fake-1', name: 'Test Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'test.fake' }, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
}, { wallet: fixture.wallet })

const page = await context.newPage()
const errors = []
page.on('console', (message) => message.type() === 'error' && !message.text().startsWith('Failed to load resource') && errors.push(message.text()))
page.on('pageerror', (error) => errors.push(error.message))
const prepareBodies = []

await page.route('**/api/status', async (route) => {
  const response = await route.fetch()
  const body = await response.json()
  body.base = { ...body.base, network: 'base-sepolia', chainId: 84532, clankerLaunch: true }
  await route.fulfill({ response, json: body })
})
await page.route(`**/api/deployments?id=${id}`, (route) => route.fulfill({ json: { ...fixture.remote, tokens: [] } }))
await page.route('**/api/tokens', async (route) => {
  const body = route.request().postDataJSON()
  prepareBodies.push(body)
  if (body?.action === 'prepare-clanker') return route.fulfill({ status: 201, json: { prepared: fixture.prepared } })
  return route.fulfill({ status: 500, json: { error: { code: 'UNEXPECTED', message: body?.action } } })
})

await page.goto(`${BASE}/network/${id}`, { waitUntil: 'networkidle' })
await page.locator('.nc-metrics').waitFor({ timeout: 15000 })
const head = await page.locator('.nc-head').innerText()
check(/Registered · Base Sepolia/i.test(head), 'console header names Base Sepolia', head.slice(0, 200))
await page.screenshot({ path: `${shots}01-console.png` })

await page.getByRole('button', { name: /Launch a token/ }).first().click()
const dialog = page.locator('.build-dialog')
await dialog.waitFor()
const kinds = await dialog.innerText()
check(/Clanker token/.test(kinds) && !/SPL token|Pump\.fun token/.test(kinds), 'Base offers Clanker only')
await page.screenshot({ path: `${shots}02-kind.png` })
await dialog.getByRole('button', { name: /Continue/ }).click()
await dialog.getByRole('button', { name: /Review transaction/ }).click()
await dialog.locator('.mf-review').waitFor({ timeout: 15000 })
const review = await dialog.innerText()
check(review.includes('0xE85A59c628F7d27878ACeB4bf3b35733630083a9'), 'review shows the Clanker v4 factory')
check(/Value sent\s*0 ETH/i.test(review), 'review shows 0 ETH sent')
check(/100,000,000,000 · 18 decimals/.test(review), 'review shows fixed supply')
check(/WETH/.test(review) && /100% of the creator share/.test(review), 'review shows the WETH pair and LP reward recipient')
check(/permanent tag/.test(review), 'review warns the descendant tag is permanent')
const sign = dialog.getByRole('button', { name: /Sign and launch/ })
check(await sign.isDisabled(), 'signing is blocked until the acknowledgement is ticked')
await page.screenshot({ path: `${shots}03-review.png` })
check(prepareBodies[0]?.action === 'prepare-clanker' && prepareBodies[0]?.wallet?.toLowerCase() === fixture.wallet.toLowerCase(), 'prepare asked for the connected wallet', JSON.stringify(prepareBodies[0]))

await dialog.locator('.lt-ack input').check()
await sign.click()
await dialog.locator('.failure').waitFor({ timeout: 10000 })
await page.waitForTimeout(900)
check(/WALLET REJECTED/i.test(await dialog.innerText()), 'a refused signature says nothing was signed')
const sent = await page.evaluate(() => window.__sent)
check(sent.length === 1 && sent[0][0].to === fixture.prepared.to && sent[0][0].data === fixture.prepared.data && sent[0][0].value === '0x0', 'the wallet was asked to send exactly the prepared call', JSON.stringify(sent).slice(0, 160))
check(!prepareBodies.some((body) => body?.action === 'verify-clanker'), 'nothing is verified after the wallet refuses')
await page.screenshot({ path: `${shots}04-rejected.png` })

check(errors.length === 0, 'no console errors', errors.join(' | '))
await browser.close()
console.log(notes.join('\n'))
console.log(failures.length ? `\n${failures.join('\n')}\n\n${failures.length} failed, ${notes.length} passed` : `\nall ${notes.length} checks passed`)
process.exit(failures.length ? 1 : 0)
