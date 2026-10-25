import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE ?? 'http://127.0.0.1:5173'
const out = new URL('./shots/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const width = Number(process.env.W ?? 1600)
const height = Number(process.env.H ?? 900)
const tag = process.env.TAG ?? 'd'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`[${msg.type()}] ${msg.text()}`)
})
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`))

const shot = async (name) => page.screenshot({ path: `${out}${tag}-${name}.png` })
const settle = (ms) => page.waitForTimeout(ms)

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await settle(1200)
await shot('home-idle')
await settle(2600)
await shot('home-charging')
await settle(3400)
await shot('home-complete')
for (const [index, y] of [1, 2, 3, 4, 5, 6].entries()) {
  await page.evaluate((k) => window.scrollTo(0, k * window.innerHeight * 0.95), y)
  await settle(1100)
  await shot(`home-s${index + 1}`)
}
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await settle(900)
await shot('home-end')

await page.goto(`${base}/create`, { waitUntil: 'networkidle' })
await settle(1600)
await shot('lab-top')
await page.evaluate(() => document.querySelector('#station-4')?.scrollIntoView())
await settle(900)
await shot('lab-dna')
await page.evaluate(() => document.querySelector('#station-7')?.scrollIntoView())
await settle(900)
await shot('lab-genesis')

await page.goto(`${base}/species/shadow`, { waitUntil: 'networkidle' })
await settle(1600)
await shot('specimen')
await page.goto(`${base}/explore`, { waitUntil: 'networkidle' })
await settle(1800)
await shot('explore')
await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.4))
await settle(1200)
await shot('explore-grid')
await page.goto(`${base}/token`, { waitUntil: 'networkidle' })
await settle(1600)
await shot('token')

console.log(errors.length ? errors.join('\n') : 'no console errors')
await browser.close()
