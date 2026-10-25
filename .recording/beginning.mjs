// Screenshots of the homepage post-genesis sequence at each stage, desktop and mobile.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const shots = new URL('./shots/beginning/', import.meta.url).pathname
mkdirSync(shots, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const steps = page.locator('.beg-steps li')
  const count = await steps.count()
  for (const index of [0, 1, 2, 4, 6]) {
    await steps.nth(index).evaluate((node) => {
      const box = node.getBoundingClientRect()
      window.scrollBy(0, box.top + box.height / 2 - window.innerHeight * 0.66)
    })
    await page.waitForTimeout(1400)
    const active = await page.locator('.beg-steps li.is-on h3').innerText()
    console.log(`${name} step ${index}: active = ${active}`)
    await page.screenshot({ path: `${shots}${name}-${index}.png` })
  }
  await page.locator('#era-title').scrollIntoViewIfNeeded()
  await page.locator('.era-names summary').first().click()
  await page.waitForTimeout(400)
  await page.locator('.era-grid').screenshot({ path: `${shots}${name}-era.png` })
  await page.locator('#evo-title').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await page.locator('.evo-genes').screenshot({ path: `${shots}${name}-genes.png` })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  console.log(`${name}: ${count} steps, overflow ${overflow}px`)
  await context.close()
}
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no errors')
await browser.close()
