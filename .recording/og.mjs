import { chromium } from 'playwright-core'

const base = process.env.BASE ?? 'http://127.0.0.1:5173'
const target = new URL('../public/og.jpg', import.meta.url).pathname

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await page.addStyleTag({
  content: `.nav, .tabbar, .hero-ctas, .hero-copy > p:not(.eyebrow), .console { display: none !important; }
    .hero { min-height: 630px !important; }
    .hero-inner { padding-bottom: 150px !important; }`,
})
await page.waitForFunction(() => document.querySelector('.console-foot.is-result') !== null, null, { timeout: 20000 })
await page.waitForTimeout(1800)
await page.screenshot({ path: target, type: 'jpeg', quality: 90 })
await browser.close()
console.log('wrote', target)
