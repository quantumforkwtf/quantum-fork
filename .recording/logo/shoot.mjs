import { chromium } from 'playwright-core'

const [, , file = 'sheet.html', out = 'sheet.png', w = '1400', h = '1100', scale = '1'] = process.argv
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(scale) })
await page.goto(new URL(file, import.meta.url).href)
await page.waitForTimeout(800)
await page.screenshot({ path: new URL(out, import.meta.url).pathname, omitBackground: true })
await browser.close()
console.log('wrote', out)
