import { chromium } from 'playwright-core'

const base = process.env.BASE ?? 'http://127.0.0.1:5173'
const out = (name) => new URL(name, import.meta.url).pathname
const browser = await chromium.launch({ channel: 'chrome', headless: true })

const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await deskCtx.addInitScript(() => localStorage.setItem('qfork.tour.v1', 'skipped'))
const desk = await deskCtx.newPage()
await desk.goto(`${base}/`, { waitUntil: 'networkidle' })
await desk.waitForTimeout(1200)
await desk.screenshot({ path: out('site-nav.png'), clip: { x: 0, y: 0, width: 720, height: 80 } })
const footer = desk.locator('.footer-brand')
await footer.scrollIntoViewIfNeeded()
await desk.waitForTimeout(400)
await footer.screenshot({ path: out('site-footer.png') })

const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
await phoneCtx.addInitScript(() => localStorage.setItem('qfork.tour.v1', 'skipped'))
const phone = await phoneCtx.newPage()
await phone.goto(`${base}/`, { waitUntil: 'networkidle' })
await phone.waitForTimeout(1200)
await phone.screenshot({ path: out('site-phone.png') })
await browser.close()
console.log('ok')
