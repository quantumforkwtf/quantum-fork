// Rough comprehension audit: page length, specialist vocabulary and honesty-label density as a first-time visitor sees them.
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'https://quantumfork.wtf'
const JARGON = ['descendant', 'genome', 'genesis', 'ancestor', 'organism', 'mutation', 'locus', 'loci', 'lattice', 'post-quantum', 'PQ', 'ML-DSA', 'SLH-DSA', 'Ed25519', 'validator', 'RPC', 'burn', 'SPL', 'hybrid', 'strain', 'fork']
const LABELS = ['SIMULATED', 'DEMO DATA', 'DEMO', 'NOT PROVISIONED', 'COMING SOON', 'NOT MEASURED', 'NO SERVERS', 'UNPRICED', 'RESEARCH']

const count = (text, word) => (text.match(new RegExp(`\\b${word.replace(/[-]/g, '\\-')}\\b`, 'gi')) ?? []).length
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
const page = await context.newPage()

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
const firstScreen = await page.evaluate(() => {
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    const rect = node.parentElement?.getBoundingClientRect()
    if (rect && rect.top < window.innerHeight && rect.bottom > 0 && node.textContent.trim()) out.push(node.textContent.trim())
  }
  return out.join(' ')
})
const home = await page.locator('main').innerText()
const heads = await page.$$eval('main h2', (nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, ' ').trim()))
const height = await page.evaluate(() => Math.round(document.documentElement.scrollHeight / window.innerHeight))
console.log(`HOME: ${home.split(/\s+/).length} words, ${heads.length} sections, ~${height} screens tall`)
console.log(`first screen: ${firstScreen.slice(0, 400)}`)
console.log('jargon on home:', JARGON.map((word) => [word, count(home, word)]).filter(([, n]) => n).map(([w, n]) => `${w}×${n}`).join(' '))

/* a fresh network, as a first-time builder would see it */
await page.goto(`${BASE}/lab?blueprint=quantum-chain`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Continue/ }).click()
for (let index = 0; index < 4; index++) {
  const next = page.locator('.step-nav .btn-primary')
  if (!(await next.count())) break
  await next.click()
  await page.waitForTimeout(300)
}
const hold = page.locator('.hold', { hasText: 'RUN SIMULATED REACTION' })
await hold.scrollIntoViewIfNeeded()
const box = await hold.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.waitForTimeout(1800)
await page.mouse.up()
await page.locator('.chamber-result').getByRole('button', { name: 'Open network' }).waitFor({ timeout: 30000 })
const steps = await page.evaluate(() => document.querySelectorAll('.station').length)
await page.locator('.chamber-result').getByRole('button', { name: 'Open network' }).click()
await page.waitForTimeout(1500)
const consoleText = await page.locator('main').innerText()
const consoleFold = await page.evaluate(() => document.querySelector('main')?.innerText.slice(0, 900))
console.log(`\nLAB: ${steps} stations before genesis`)
console.log(`CONSOLE: ${consoleText.split(/\s+/).length} words`)
console.log('labels on console:', LABELS.map((word) => [word, count(consoleText, word)]).filter(([, n]) => n).map(([w, n]) => `${w}×${n}`).join(' '))
console.log(`console top: ${consoleFold.replace(/\s+/g, ' ')}`)
await browser.close()
