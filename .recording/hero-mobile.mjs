// The mobile hero below the fold: reactor, caption and build panel, plus a pinned pick.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const out = new URL('./shots/hero/', import.meta.url).pathname
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] })
for (const [name, viewport] of [['mob', { width: 390, height: 844 }], ['desk', { width: 1440, height: 900 }]]) {
  const context = await browser.newContext({ viewport, hasTouch: name === 'mob' })
  await context.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  if (name === 'mob') {
    await page.evaluate(() => window.scrollTo(0, 420))
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${out}${name}-below.png` })
  }
  await page.getByRole('button', { name: /Private network/ }).click()
  await page.waitForTimeout(2600)
  await page.screenshot({ path: `${out}${name}-pinned.png` })
  console.log(name, await page.locator('.bc-go').getAttribute('href'), await page.locator('.reactor-hud strong').textContent())
  await page.waitForTimeout(6000)
  console.log(name, 'still pinned:', await page.locator('.reactor-hud strong').textContent())
  await context.close()
}
await browser.close()
