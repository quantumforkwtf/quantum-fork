import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const BASE = process.env.QA_URL ?? 'http://127.0.0.1:5173'
const RPC = 'https://sepolia.base.org'
const WETH = '0x4200000000000000000000000000000000000006'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const finalized = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['finalized', false] }) }).then((r) => r.json())
const block = Number(BigInt(finalized.result.number))
console.log('fork block', block)

const nodes = [8545, 8546].map((port) => spawn('anvil', ['--fork-url', RPC, '--fork-block-number', String(block), '--port', String(port), '--silent'], { stdio: 'ignore' }))
const ready = async (port) => {
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' }).then((r) => r.ok).catch(() => false)
    if (ok) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`anvil ${port} did not start`)
}
await Promise.all([ready(8545), ready(8546)])

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.addInitScript(() => localStorage.setItem('qfork.tour.v1', 'skipped'))
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  await page.goto(`${BASE}/lab/reality-fork?source=base-sepolia&block=${block}`, { waitUntil: 'networkidle' })
  check('page renders with the fork banner', await page.getByText('FORK, NOT BASE.').isVisible())
  check('commands use the chosen block', (await page.locator('.gs-command').first().textContent()).includes(`--fork-block-number ${block}`))
  check('run is disabled before verification', await page.getByRole('button', { name: /Run on both forks/ }).isDisabled())

  await page.getByRole('button', { name: 'Check both forks' }).click()
  await page.locator('.rf-node.is-ok').nth(1).waitFor({ timeout: 20_000 })
  check('both forks verified against the real block hash', (await page.locator('.rf-node.is-ok').count()) === 2)

  const change = page.locator('.rf-item').first()
  await change.getByLabel('Address').fill(WETH)
  await change.getByLabel('Runtime bytecode').fill('0x60006000fd')
  const call = page.locator('.rf-call').first()
  await call.getByLabel('Label').fill('Wrap 1 ETH')
  await call.getByLabel('To').fill(WETH)
  await call.getByLabel('Value (ETH)').fill('1')
  await call.getByLabel('Function signature').fill('deposit()')
  await call.getByRole('button', { name: 'Encode' }).click()
  check('calldata encoded', (await call.getByLabel('Calldata').inputValue()) === '0xd0e30db0')

  await page.getByRole('button', { name: /Run on both forks/ }).click()
  await page.locator('.rf-results').waitFor({ timeout: 60_000 })
  const status = page.locator('.rf-compare tr', { hasText: 'Status' })
  check('original succeeded, modified reverted', (await status.locator('td').nth(2).textContent()) === 'success' && (await status.locator('td').nth(3).textContent()) === 'reverted')
  const events = page.locator('.rf-compare tr', { hasText: 'Events' })
  check('deposit event only on the original', (await events.locator('td').nth(2).textContent()) === '1' && (await events.locator('td').nth(3).textContent()) === '0')
  check('WETH state change only on the original', (await page.locator(`.rf-compare code[title^="${WETH} storage:"]`).count()) > 0)
  await page.screenshot({ path: './reality-fork.png', fullPage: true })
  await page.locator('.rf-results').scrollIntoViewIfNeeded()
  await page.locator('.rf-results').screenshot({ path: './reality-fork-results.png' })

  await page.getByRole('button', { name: /Run on both forks/ }).click()
  await page.waitForTimeout(3000)
  check('rerun gives the same comparison', (await status.locator('td').nth(3).textContent()) === 'reverted')

  await page.goto(`${BASE}/lab/reality-fork`, { waitUntil: 'networkidle' })
  await page.locator('.rf-node input').first().fill('https://sepolia.base.org/')
  await page.locator('input[placeholder="e.g. 32000000"]').fill(String(block))
  await page.getByRole('button', { name: 'Check both forks' }).click()
  await page.locator('.rf-node.is-failed').first().waitFor({ timeout: 20_000 })
  check('refuses a non-loopback endpoint', ((await page.locator('.rf-node.is-failed small').first().textContent()) ?? '').includes('never sent to a public network'))

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mobile.addInitScript(() => localStorage.setItem('qfork.tour.v1', 'skipped'))
  await mobile.goto(`${BASE}/lab/reality-fork?block=${block}`, { waitUntil: 'networkidle' })
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  check('no horizontal overflow on mobile', overflow <= 1, `${overflow}px`)
  await mobile.screenshot({ path: './reality-fork-mobile.png', fullPage: false })
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  nodes.forEach((node) => node.kill())
}
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
