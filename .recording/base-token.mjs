// Screenshots the token page data section.
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.goto(`${BASE}/qfork`, { waitUntil: 'networkidle' })
await page.locator('#live-title').scrollIntoViewIfNeeded()
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/base-token-data.png' })
await page.locator('#terms-title').scrollIntoViewIfNeeded()
await page.screenshot({ path: '/tmp/base-token-terms.png' })
console.log('errors', JSON.stringify(errors))
await browser.close()
