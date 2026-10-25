// Screenshots of the homepage story: hero states, the build dialog and each section.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const out = new URL('./shots/hero/', import.meta.url).pathname
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] })
const errors = []

async function run(name, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  await context.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`))
  page.on('console', (message) => message.type() === 'error' && errors.push(`${name}: ${message.text()}`))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${out}${name}-0-intro.png` })
  for (const [index, wait] of [[1, 3600], [2, 4800], [3, 4800], [4, 4800], [5, 4800]]) {
    await page.waitForTimeout(wait)
    await page.screenshot({ path: `${out}${name}-${index}-build.png` })
  }
  await page.getByRole('link', { name: /Start building/ }).first().click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}${name}-dialog.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  for (const id of ['bp-home-title', 'era-title', 'scan-home-title', 'dna-title', 'evo-title', 'flow-title', 'teaser-title']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded()
    await page.evaluate((target) => document.getElementById(target)?.closest('section')?.scrollIntoView({ block: 'start' }), id)
    await page.waitForTimeout(id === 'scan-home-title' ? 4200 : 1200)
    await page.screenshot({ path: `${out}${name}-s-${id}.png` })
  }
  await context.close()
}

await run('desk', { width: 1440, height: 900 })
await run('mob', { width: 390, height: 844 })
await browser.close()
console.log(errors.length ? errors.join('\n') : 'no console errors')
