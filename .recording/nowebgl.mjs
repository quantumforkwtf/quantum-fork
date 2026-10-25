import { chromium } from 'playwright-core'

const base = process.env.BASE ?? 'http://127.0.0.1:5173'
const out = new URL('./shots/', import.meta.url).pathname
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--disable-3d-apis'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))
for (const path of ['/', '/create', '/explore', '/token']) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const canvases = await page.locator('canvas').count()
  const svgs = await page.locator('svg.organism, .organism svg, svg[class*="organism"]').count()
  console.log(path, { canvases, svgs })
  await page.screenshot({ path: `${out}nogl${path.replace(/\//g, '-') || '-home'}.png` })
}
console.log(errors.length ? errors.join('\n') : 'no errors')
await browser.close()
