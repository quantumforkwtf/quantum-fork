// Product shots for the promo, taken from the running site at 2x.
// node .recording/promo/capture.mjs
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const out = new URL('./shots/', import.meta.url).pathname
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await context.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
const page = await context.newPage()
const shot = async (name) => {
  await page.screenshot({ path: `${out}${name}.png` })
  console.log('shot', name)
}
const tall = () => page.setViewportSize({ width: 1440, height: 1500 })
const short = () => page.setViewportSize({ width: 1440, height: 900 })
const hideNav = () => page.addStyleTag({ content: '.tabbar { display: none !important; }' })

/* blueprints */
await tall()
await page.goto(`${BASE}/blueprints`, { waitUntil: 'networkidle' })
await hideNav()
await page.waitForTimeout(2500)
await shot('blueprints')

/* scanner */
await page.goto(`${BASE}/scanner`, { waitUntil: 'networkidle' })
await hideNav()
await page.getByRole('button', { name: /Run quantum scan/ }).click()
await page.waitForFunction(() => !document.body.innerText.includes('NOT SCANNED'), null, { timeout: 30000 }).catch(() => console.log('scan did not finish'))
await page.waitForTimeout(2500)
await shot('scanner')

/* home hero, a build selected */
await short()
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => document.querySelector('.console-foot.is-result') !== null, null, { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(1800)
await shot('home')

/* genesis */
await page.goto(`${BASE}/lab?blueprint=quantum-chain`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Continue/ }).click()
for (let index = 0; index < 4; index++) {
  const next = page.locator('.step-nav .btn-primary')
  if (!(await next.count())) break
  await next.click()
  await page.waitForTimeout(300)
}
const hold = page.locator('.hold', { hasText: 'RUN SIMULATED REACTION' })
await hold.waitFor({ timeout: 10000 })
await hold.scrollIntoViewIfNeeded()
const box = await hold.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.waitForTimeout(1800)
await page.mouse.up()
await page.waitForTimeout(1400)
await shot('reaction')
const openNetwork = page.locator('.chamber-result').getByRole('button', { name: 'Open network' })
await openNetwork.waitFor({ timeout: 30000 })
await page.mouse.move(10, 10)
await page.waitForTimeout(1600)
await shot('genesis')

/* asset */
await page.locator('.chamber-result').getByRole('button', { name: 'Launch an asset' }).click()
await page.waitForURL(/\/network\/demo-[a-z0-9]+\/assets$/, { timeout: 10000 })
const id = page.url().match(/\/network\/(demo-[a-z0-9]+)/)[1]
const dialog = page.getByRole('dialog')
await dialog.waitFor({ timeout: 5000 })
await dialog.getByLabel('Name').fill('Quantum Credit')
await dialog.getByLabel('Symbol').fill('QCR')
await dialog.getByLabel('Supply').fill('21000000')
await dialog.getByRole('button', { name: 'Review' }).click()
await page.waitForTimeout(500)
await shot('asset-review')
await dialog.getByRole('button', { name: /Deploy · simulated/ }).click()
await dialog.getByText(/Asset issued · simulated/i).waitFor({ timeout: 10000 })
await page.waitForTimeout(600)
await dialog.getByRole('button', { name: 'Close' }).click()

/* vault */
await page.goto(`${BASE}/network/${id}`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Build on this/ }).click()
await page.getByRole('dialog').getByRole('button', { name: /Create a vault/ }).click()
const vault = page.getByRole('dialog')
await vault.getByRole('button', { name: 'Review' }).click()
await vault.getByRole('button', { name: /Deploy · simulated/ }).click()
await vault.getByText(/Vault created · simulated/i).waitFor({ timeout: 10000 })
await vault.getByRole('button', { name: 'Close' }).click()

/* console */
await tall()
await page.goto(`${BASE}/network/${id}`, { waitUntil: 'networkidle' })
await hideNav()
await page.waitForTimeout(2600)
await shot('console')

await page.goto(`${BASE}/network/${id}/developers`, { waitUntil: 'networkidle' })
await hideNav()
await page.waitForTimeout(1200)
await shot('developers')

await browser.close()
