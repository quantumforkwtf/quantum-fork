// The homepage scan should start as soon as the map scrolls in.
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#scan-home-title').scrollIntoViewIfNeeded()
  const started = Date.now()
  const done = await page.getByText('Scan complete', { exact: true }).waitFor({ timeout: 12000 }).then(() => true, () => false)
  console.log(viewport.width, done ? `complete in ${Date.now() - started} ms` : 'never completed')
  await context.close()
}
await browser.close()
