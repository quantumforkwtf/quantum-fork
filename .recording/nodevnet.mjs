// Renders every page of a mainnet build and fails if any visible text mentions devnet or test tokens.
// Usage: BASE=http://127.0.0.1:4180 node nodevnet.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4180'
const ROUTES = ['/', '/qfork', '/lab', '/lab?blueprint=quantum-chain', '/blueprints', '/blueprints/quantum-chain', '/species', '/network', '/security', '/scanner', '/quantumize']
const BANNED = /devnet|test qfork|test token|faucet/i

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
let failures = 0
for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const text = await page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll('[title]')).map((el) => el.getAttribute('title'))
    return [document.body.innerText, ...titles].join('\n')
  })
  const hits = text.split('\n').filter((line) => BANNED.test(line))
  if (hits.length) failures++
  console.log(`${hits.length ? 'FAIL' : 'ok  '} ${route}${hits.length ? '\n       ' + hits.map((h) => h.trim().slice(0, 160)).join('\n       ') : ''}`)
}
await browser.close()
console.log(failures ? `\n${failures} page(s) mention devnet` : '\nno page mentions devnet')
process.exit(failures ? 1 : 0)
