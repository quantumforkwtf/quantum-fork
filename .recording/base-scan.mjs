// Screenshots the Scanner with Base selected, after a scan.
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
await page.emulateMedia({ reducedMotion: 'reduce' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.goto(`${BASE}/scanner`, { waitUntil: 'networkidle' })
await page.getByRole('radio', { name: /^BASE/ }).click()
console.log('url', page.url())
await page.getByRole('button', { name: /Run quantum scan/ }).click()
await page.waitForTimeout(800)
console.log('eyebrow', await page.locator('.page-head .eyebrow').innerText())
console.log('tally', JSON.stringify(await page.locator('.scan-tally').innerText()))
await page.screenshot({ path: '/tmp/base-scan-top.png' })
await page.locator('#findings-title').scrollIntoViewIfNeeded()
await page.screenshot({ path: '/tmp/base-scan-findings.png' })
await page.goto(`${BASE}/lab`, { waitUntil: 'networkidle' })
console.log('lab chips', JSON.stringify(await page.locator('.chain-row').first().innerText().catch(() => 'n/a')))
console.log('errors', JSON.stringify(errors))
await browser.close()
