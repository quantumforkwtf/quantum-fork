// Screenshots the Lab requirement step with Solana and with Base selected.
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.goto(`${BASE}/lab`, { waitUntil: 'networkidle' })
for (const chain of ['solana', 'base']) {
  await page.evaluate((chain) => {
    const draft = JSON.parse(window.localStorage.getItem('qfork.lab.draft.v2') ?? '{}')
    window.localStorage.setItem('qfork.lab.draft.v2', JSON.stringify({ ...draft, step: 6, scanned: true, mode: 'expert', chain }))
  }, chain)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const picker = page.locator('[aria-labelledby="chain-label"]')
  await picker.scrollIntoViewIfNeeded()
  console.log(chain, JSON.stringify(await picker.innerText()))
  await page.screenshot({ path: `/tmp/base-lab-${chain}.png` })
}
const status = await page.evaluate(() => fetch('/api/status').then((response) => response.json()))
console.log('status.base', JSON.stringify(status.base))
console.log('errors', JSON.stringify(errors))
await browser.close()
