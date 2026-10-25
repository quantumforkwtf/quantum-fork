import { chromium } from 'playwright-core'

const BASE = process.env.QA_URL ?? 'http://127.0.0.1:5173'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.addInitScript(() => localStorage.setItem('qfork.tour.v1', 'skipped'))
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  await page.goto(`${BASE}/lab/quantum-shield`, { waitUntil: 'networkidle' })
  check('states that Base does not become quantum-resistant', await page.getByText('Base itself does not become quantum-resistant').isVisible())
  check('nothing is measured before running', (await page.locator('.qs-table td', { hasText: 'not measured' }).count()) === 7)

  await page.getByRole('button', { name: 'Run benchmark' }).click()
  await page.getByRole('button', { name: 'Run again' }).waitFor({ timeout: 120_000 })
  const selfChecks = await page.locator('.qs-table small', { hasText: 'verified · tamper rejected' }).count()
  check('all seven schemes measured and self-checked', selfChecks === 7, `${selfChecks}/7`)
  const row = (label) => page.locator('.qs-table tr', { hasText: label })
  check('ML-DSA-44 signature is 2,420 bytes', ((await row('ML-DSA-44').locator('td').nth(2).textContent()) ?? '').startsWith('2,420 B'))
  check('secp256k1 signature is 65 bytes', ((await row('ECDSA secp256k1').locator('td').nth(2).textContent()) ?? '').startsWith('65 B'))
  check('device line shown', ((await page.locator('.qs-bench-head small').textContent()) ?? '').includes('logical cores'))
  await page.locator('.qs-bench').screenshot({ path: './quantum-shield-bench.png' })

  const play = page.locator('.qs-play')
  await play.getByRole('button', { name: /Generate keys/ }).click()
  await play.locator('dt', { hasText: 'Public key · 1,312 B' }).waitFor()
  await play.getByRole('button', { name: /Sign/ }).click()
  await play.locator('dt', { hasText: 'Signature · 2,420 B' }).waitFor()
  await play.getByRole('button', { name: /Verify/ }).click()
  await play.locator('.qs-verdict.is-ok').waitFor()
  check('valid signature verifies', true)
  await play.getByLabel('Flip one bit of the signature').check()
  await play.getByRole('button', { name: /Verify/ }).click()
  await play.locator('.qs-verdict.is-bad').waitFor()
  check('flipped bit is rejected', true)
  await page.screenshot({ path: './quantum-shield.png', fullPage: true })

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mobile.addInitScript(() => localStorage.setItem('qfork.tour.v1', 'skipped'))
  await mobile.goto(`${BASE}/lab/quantum-shield`, { waitUntil: 'networkidle' })
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  check('no horizontal overflow on mobile', overflow <= 1, `${overflow}px`)
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
