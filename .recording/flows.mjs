import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE ?? 'http://127.0.0.1:5173'
const out = new URL('./shots/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const mobile = process.env.MOBILE === '1'
const tag = mobile ? 'm' : 'd'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const context = await browser.newContext(
  mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1600, height: 900 } },
)
const page = await context.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`)
})
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`))
const shot = (name) => page.screenshot({ path: `${out}${tag}-flow-${name}.png` })
const settle = (ms) => page.waitForTimeout(ms)

async function hold(locator, ms = 1100) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await settle(ms)
  await page.mouse.up()
}

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.goto(`${base}/create`, { waitUntil: 'networkidle' })
await settle(1200)
if (mobile) {
  await shot('lab-top')
  await page.evaluate(() => window.scrollTo(0, 900))
  await settle(900)
  await shot('lab-scroll')
}
const name = page.locator('.text-field input').first()
await name.fill('AURORA')
await page.locator('.tile', { hasText: 'WASM' }).click()
await page.locator('.segmented button', { hasText: 'HYBRID' }).click()
await page.locator('.tile', { hasText: 'SHIELDED' }).first().click()
await settle(800)
await page.locator('button', { hasText: 'Connect demo wallet' }).click()
await page.locator('button', { hasText: 'BURN & CREATE' }).click()
await settle(500)
await shot('confirm')
await hold(page.locator('.dialog .hold'))
await settle(1800)
await shot('genesis-charging')
await settle(1700)
await shot('genesis-assembling')
await page.waitForSelector('.chamber-result.is-shown', { timeout: 15000 })
await settle(1200)
await shot('genesis-done')

await page.locator('.chamber-result button', { hasText: 'MUTATE' }).click()
await page.waitForURL(/species/)
await settle(1500)
await shot('mutate-bay')
await page.locator('.mutation-card', { hasText: 'DEADMAN GENE' }).locator('.mc-action button').click()
await settle(1700)
await shot('mutation-run')
await page.waitForSelector('.chamber-result.is-shown', { timeout: 15000 })
await settle(800)
await shot('mutation-done')
await page.keyboard.press('Escape')
await settle(400)

await page.locator('.specimen-actions button', { hasText: 'Fork' }).click()
await settle(1200)
await page.locator('.fork-genes .mutation-card', { hasText: 'TURBO GENE' }).locator('.mc-select').click()
await settle(1200)
await shot('fork-bay')
await hold(page.locator('.fork-preview .hold'))
await settle(1500)
await shot('fork-copy')
await settle(1700)
await shot('fork-split')
await page.waitForSelector('.chamber-result.is-shown', { timeout: 15000 })
await settle(900)
await shot('fork-done')

console.log(errors.length ? errors.join('\n') : 'no errors')
await browser.close()
