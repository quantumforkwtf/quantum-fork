import { chromium } from 'playwright-core'

const base = process.env.BASE ?? 'http://127.0.0.1:5173'
const target = new URL('../public/qfork-token.png', import.meta.url).pathname

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2 })
await page.goto(`${base}/token`, { waitUntil: 'networkidle' })
await page.addStyleTag({
  content: `body > *:not(#root), .nav, .tabbar, .footer, .grain { display: none !important; }
    .token-coin { position: fixed !important; inset: 0 !important; z-index: 9999 !important; width: 100vw !important; height: 100vh !important;
      max-width: none !important; margin: 0 !important; background: #060708; -webkit-mask-image: none !important; mask-image: none !important; }`,
})
await page.waitForSelector('.token-coin.is-ready, .token-coin .is-ready', { timeout: 15000 }).catch(() => {})
await page.mouse.move(500, 500)
await page.waitForTimeout(2600)
await page.screenshot({ path: target, clip: { x: 200, y: 200, width: 600, height: 600 } })
await browser.close()
console.log('wrote', target)
