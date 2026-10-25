import { chromium } from 'playwright-core'

const BASE = process.env.QA_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const skipTour = () => window.localStorage.setItem('qfork.tour.v1', 'skipped')
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.addInitScript(skipTour)
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))

await page.goto(`${BASE}/create`, { waitUntil: 'networkidle' })
check('studio renders', await page.getByRole('heading', { level: 1 }).isVisible())
check('three targets', (await page.locator('.gs-target').count()) === 3)
check('genome drawn', (await page.locator('.gs-genome .genome-arc').count()) > 0)
await page.screenshot({ path: './studio-base.png', fullPage: false })

await page.locator('.gs-tabs button', { hasText: /^Execution/ }).click()
const disabled = await page.locator('.dna-option:disabled').count()
check('unsupported options disabled on Base', disabled > 0, `${disabled} disabled`)
await page.screenshot({ path: './studio-base-exec.png', fullPage: false })

await page.locator('.gs-target').nth(1).click()
await page.waitForTimeout(200)
check('anvil command shown for local devnet', (await page.locator('.gs-command').textContent())?.includes('anvil') ?? false)
await page.screenshot({ path: './studio-local.png', fullPage: false })

await page.locator('.gs-target').nth(2).click()
await page.waitForTimeout(200)
const blocked = await page.locator('.readiness .is-blocked').count()
check('op-stack provisioning shown blocked', blocked > 0)
await page.screenshot({ path: './studio-opstack.png', fullPage: true })

await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle' })
check('explore renders', await page.getByRole('heading', { name: /published configurations/i }).isVisible())
await page.screenshot({ path: './explore.png', fullPage: false })

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await mobile.addInitScript(skipTour)
mobile.on('pageerror', (error) => errors.push(error.message))
await mobile.goto(`${BASE}/create`, { waitUntil: 'networkidle' })
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check('no horizontal overflow on mobile', overflow <= 1, `${overflow}px`)
await mobile.screenshot({ path: './studio-mobile.png', fullPage: false })

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
