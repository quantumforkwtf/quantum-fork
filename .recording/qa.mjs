// End-to-end functional sweep: every route, every API endpoint, the code scanner and the lab up to the burn.
// BASE=https://quantumfork.wtf node .recording/qa.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const failures = []
const notes = []
const check = (ok, label, detail = '') => {
  if (ok) notes.push(`ok   ${label}`)
  else failures.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

/* ---------- API ---------- */

async function get(path, init) {
  const started = Date.now()
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init })
  const type = response.headers.get('content-type') ?? ''
  const body = type.includes('json') ? await response.json() : type.startsWith('image/') ? await response.arrayBuffer() : await response.text()
  return { status: response.status, type, body, ms: Date.now() - started }
}

const status = await get('/api/status')
check(status.status === 200 && status.body.flags, 'GET /api/status', `${status.status}`)
{
  const body = status.body ?? {}
  const mainnet = body.network === 'mainnet-beta'
  const expected = mainnet ? body.flags?.mainnetDeployments === true && body.tokenStatus === 'LIVE' && body.storage?.persistent === true && Boolean(body.mint) : false
  check(body.tiers?.mainnet?.available === expected, 'mainnet registration only when the site is on mainnet with a live mint, storage and the flag', JSON.stringify(body.tiers?.mainnet))
  check(!mainnet || body.tiers?.testnet?.available === false, 'no devnet registration on a mainnet site', JSON.stringify(body.tiers?.testnet))
  check(!mainnet || body.faucet?.available === false, 'no faucet on mainnet', JSON.stringify(body.faucet))
}
check(status.body?.tiers && !('demo' in status.body.tiers), 'no demo tier is offered', JSON.stringify(Object.keys(status.body?.tiers ?? {})))
check(typeof status.body?.faucet?.available === 'boolean', 'status reports the faucet', JSON.stringify(status.body?.faucet))

for (const query of ['', '?blueprint=quantumize-my-app', '?blueprint=quantum-chain', '?species=solana', '?page=blueprints', '?page=build', '?blueprint=__proto__']) {
  const og = await get(`/api/og${query}`)
  check(og.status === 200 && og.type.startsWith('image/png') && og.body.byteLength > 5000, `GET /api/og${query}`, `${og.status} ${og.type}`)
}

for (const [path, title] of [
  ['/api/page?kind=blueprint&id=quantumize-my-app', 'Quantumize My App'],
  ['/api/page?kind=species&id=solana', 'SOLANA'],
  ['/api/page?kind=blueprints', 'Blueprints'],
  ['/api/page?kind=build', 'build'],
]) {
  const page = await get(path)
  check(page.status === 200 && new RegExp(title, 'i').test(page.body) && !/unaudited/i.test(page.body), `GET ${path}`, `${page.status}`)
}

const token = await get('/api/token')
check(token.status < 500, 'GET /api/token', `${token.status}`)
const descendants = await get('/api/descendants')
check(descendants.status < 500, 'GET /api/descendants', `${descendants.status}`)
const badBurn = await get('/api/burns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
check(badBurn.status >= 400 && badBurn.status < 500, 'POST /api/burns rejects an empty body', `${badBurn.status}`)
const badToken = await get('/api/tokens?mint=not-a-mint')
check(badToken.status >= 400 && badToken.status < 500, 'GET /api/tokens rejects a bad mint', `${badToken.status}`)
const noTokens = await get('/api/tokens?deployment=dep_0000000000000000')
check(noTokens.status < 500, 'GET /api/tokens for an unknown descendant', `${noTokens.status}`)
const badLaunch = await get('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"verify"}' })
check(badLaunch.status >= 400 && badLaunch.status < 500, 'POST /api/tokens rejects an incomplete body', `${badLaunch.status}`)
const strangerLaunch = await get('/api/tokens', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'prepare-spl', deploymentId: 'dep_0000000000000000', wallet: '11111111111111111111111111111111', spec: { name: 'X', symbol: 'XX', description: '', decimals: 6, supply: '1', fixedSupply: true } }),
})
check(
  (strangerLaunch.status >= 400 && strangerLaunch.status < 500) || strangerLaunch.body?.error?.code === 'STORAGE_NOT_PERSISTENT',
  'POST /api/tokens refuses a launch for an unknown descendant',
  `${strangerLaunch.status} ${strangerLaunch.body?.error?.code}`,
)
const badFaucet = await get('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"wallet":"nope"}' })
check(badFaucet.status >= 400 && badFaucet.status < 500, 'POST /api/faucet rejects a bad wallet', `${badFaucet.status}`)
const tokenImage = await get('/api/og?token=11111111111111111111111111111111')
check(tokenImage.status < 500, 'GET /api/og?token=', `${tokenImage.status}`)
const badDeploy = await get('/api/deployments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"tier":"mainnet"}' })
check(badDeploy.status >= 400 && badDeploy.status < 500, 'POST /api/deployments rejects mainnet', `${badDeploy.status}`)
const demoDeploy = await get('/api/deployments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"tier":"demo"}' })
check(demoDeploy.status >= 400 && demoDeploy.status < 500, 'POST /api/deployments rejects the old demo tier', `${demoDeploy.status}`)

const scans = [
  ['panva/jose', (d) => d.source.commit && d.summary.vulnerableInCode > 0 && d.surfaces.length > 3],
  ['https://github.com/paulmillr/noble-post-quantum', (d) => d.summary.postQuantum > 100 && d.summary.hybrid > 0],
  ['https://github.com/anza-xyz/wallet-adapter/tree/master', (d) => d.source.ref === 'master' && d.dependencies.some((dep) => dep.name === '@solana/web3.js')],
  ['solana-labs/solana-program-library', (d) => d.stats.filesScanned > 300],
]
for (const [repo, ok] of scans) {
  const scan = await get(`/api/scan?repo=${encodeURIComponent(repo)}`)
  check(scan.status === 200 && ok(scan.body), `scan ${repo} (${scan.ms} ms)`, scan.body?.error?.message ?? JSON.stringify(scan.body?.summary ?? scan.status))
}
const missing = await get('/api/scan?repo=nobody-xyz-123/does-not-exist')
check(missing.status === 404 && missing.body.error.code === 'REPOSITORY_NOT_FOUND', 'scan of a missing repo is a clean 404', `${missing.status}`)
const invalid = await get('/api/scan?repo=../../etc')
check(invalid.status === 400, 'scan rejects invalid input', `${invalid.status}`)
const badRef = await get('/api/scan?repo=panva/jose&ref=no-such-branch-xyz')
check(badRef.status === 404, 'scan of a missing branch is a clean 404', `${badRef.status}`)

/* ---------- browser ---------- */

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const shots = new URL('./shots/qa/', import.meta.url).pathname
rmSync(shots, { recursive: true, force: true })
mkdirSync(shots, { recursive: true })

async function open(viewport, { tour = false } = {}) {
  const context = await browser.newContext({ ...viewport, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] })
  if (!tour) await context.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
  const page = await context.newPage()
  const errors = []
  // Failed requests are reported with their URL by the response listener below.
  page.on('console', (message) => message.type() === 'error' && !message.text().startsWith('Failed to load resource') && errors.push(message.text()))
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    const url = response.url()
    const expected = url.includes('/api/scan') || (response.status() === 404 && url.includes('/api/deployments?id=dep_0000000000000000'))
    if (response.status() >= 500 || (response.status() >= 400 && url.startsWith(BASE) && !expected)) errors.push(`${response.status()} ${url}`)
  })
  return { context, page, errors }
}

const ROUTES = [
  '/',
  '/build',
  '/blueprints',
  ...['quantum-chain', 'quantum-vault', 'quantum-payments', 'private-quantum-network', 'quantum-ai-economy', 'enterprise-quantum-network', 'quantumize-my-app', 'quantumize-my-chain', 'custom'].map((slug) => `/blueprints/${slug}`),
  '/lab',
  '/lab?blueprint=quantum-vault',
  '/scanner',
  '/species',
  '/species/solana',
  '/qfork',
  '/security',
  '/quantumize',
  '/burn/5VERYfakeSignature1111111111111111111111111111111111111111111111111111111111111111',
  '/network',
  '/network/dep_0000000000000000',
  '/network/dep_0000000000000000/tokens',
  '/network/solana',
  '/does-not-exist',
]

const DESKTOP = { viewport: { width: 1440, height: 900 } }
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

for (const [name, viewport] of [
  ['desktop', DESKTOP],
  ['mobile', MOBILE],
]) {
  const { context, page, errors } = await open(viewport)
  for (const route of ROUTES) {
    errors.length = 0
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const facts = await page.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent?.trim() ?? '',
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      audit: (document.body.innerText.match(/[^.\n]*\baudit\w*[^.\n]*/gi) ?? []).filter((line) => !/outside security review/i.test(line)),
      simulated: document.body.innerText.match(/[^.\n]*\b(simulat\w*|demo mode|demo data|rehearsal)[^.\n]*/gi) ?? [],
      chip: document.querySelector('.status-chip-label')?.textContent ?? '',
    }))
    check(facts.h1.length > 0, `${name} ${route} renders`, 'no h1')
    check(facts.overflow <= 1, `${name} ${route} has no horizontal overflow`, `${facts.overflow}px`)
    check(facts.audit.length === 0, `${name} ${route} has no audit wording`, facts.audit.join(' | '))
    check(facts.simulated.length === 0, `${name} ${route} has no simulated or demo wording`, facts.simulated.join(' | '))
    check(!/DEMO|REHEARSAL/.test(facts.chip), `${name} ${route} mode chip is real`, facts.chip)
    check(errors.length === 0, `${name} ${route} has no errors`, errors.join(' | '))
  }
  await context.close()
}

/* ---------- tour ---------- */
{
  const { context, page } = await open(DESKTOP, { tour: true })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const tour = page.getByRole('button', { name: 'Skip tour' })
  check(await tour.isVisible(), 'tour opens for a first visit')
  await tour.click()
  await page.reload({ waitUntil: 'networkidle' })
  check(!(await tour.isVisible()), 'skipped tour stays closed')
  await context.close()
}

/* ---------- homepage story and the build dialog ---------- */
for (const [name, viewport] of [
  ['desktop', DESKTOP],
  ['mobile', MOBILE],
]) {
  const { context, page, errors } = await open(viewport)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const h1 = (await page.locator('h1').textContent())?.replace(/\s+/g, ' ').trim()
  check(/Build for the\s*quantum future\./i.test(h1 ?? ''), `${name} hero headline`, h1)
  check(await page.getByText('No code required.', { exact: true }).isVisible(), `${name} hero says no code required`)
  const body = await page.evaluate(() => document.body.innerText)
  check(!/Rewrite their cryptography|Fork today/i.test(body), `${name} old hero copy is gone`)
  const heads = await page.$$eval('main h2', (nodes) => nodes.map((node) => node.textContent?.replace(/\s+/g, ' ').trim()))
  const story = ['What will you build?', 'Your descendant is the beginning.', 'Built for a different cryptographic era.', 'Scan the cryptographic DNA.', 'Choose the evolution.', 'Burn QFORK. Create the descendant.', 'Descendants.']
  check(story.every((head, index) => heads[index] === head), `${name} homepage tells the story in order`, heads.join(' / '))

  await page.locator('.hero-ctas').getByRole('link', { name: /Start building/ }).click()
  const dialog = page.getByRole('dialog', { name: /What do you want to build/ })
  await dialog.waitFor({ timeout: 3000 })
  check(new URL(page.url()).pathname === '/', `${name} Start building opens the dialog in place`, page.url())
  check((await dialog.locator('.intent').count()) === 9, `${name} dialog lists nine intents`)
  await page.keyboard.press('Escape')
  check(!(await dialog.isVisible()), `${name} Escape closes the dialog`)
  await page.locator('.hero-ctas').getByRole('link', { name: /Start building/ }).click()
  await dialog.getByRole('link', { name: /Upgrade an existing app/ }).click()
  await page.waitForURL(/\/quantumize/, { timeout: 5000 }).catch(() => undefined)
  check(new URL(page.url()).pathname === '/quantumize' && !(await dialog.isVisible()), `${name} an intent goes straight to its tool`, page.url())

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Payment network/ }).click()
  check((await page.locator('.reactor-hud strong').textContent()) === 'QUANTUM PAYMENTS', `${name} a build pick drives the reactor`)
  check(/\/lab\?blueprint=quantum-payments/.test((await page.locator('.bc-go').getAttribute('href')) ?? ''), `${name} the build panel links to the lab`)

  await page.locator('#scan-home-title').scrollIntoViewIfNeeded()
  await page.getByText('Scan complete', { exact: true }).waitFor({ timeout: 12000 }).catch(() => undefined)
  check(await page.getByText('Scan complete', { exact: true }).isVisible(), `${name} homepage scan runs when seen`)
  check(errors.length === 0, `${name} homepage has no errors`, errors.join(' | '))
  await context.close()
}

/* ---------- Quantumize My App ---------- */
{
  // Scans are rate-limited per calendar minute; start in a fresh window.
  await new Promise((resolve) => setTimeout(resolve, 61_000 - (Date.now() % 60_000)))
  const { context, page, errors } = await open(DESKTOP)
  const report = page.locator('.as-report')

  await page.goto(`${BASE}/quantumize?repo=panva/jose`, { waitUntil: 'networkidle' })
  await Promise.race([report.waitFor({ timeout: 60000 }), page.locator('.as-error').waitFor({ timeout: 60000 })])
  if (await page.locator('.as-error').isVisible()) throw new Error(`auto-run failed: ${await page.locator('.as-error').textContent()}`)
  check((await page.locator('.as-surface').count()) > 3, 'shared link auto-runs the scan')
  check(/\/quantumize\?repo=panva\/jose$/.test(page.url()), 'URL keeps owner/repo unencoded', page.url())

  const first = page.locator('.as-surface').first()
  const more = first.getByRole('button', { name: /Show \d+ more/ })
  if (await more.count()) {
    const before = await first.locator('.as-locations li').count()
    await more.click()
    check((await first.locator('.as-locations li').count()) > before, '"Show more" expands locations')
    await first.getByRole('button', { name: 'Show fewer' }).click()
  }
  const link = first.locator('.as-locations a').first()
  check(/^https:\/\/github\.com\/panva\/jose\/blob\/[0-9a-f]{40}\/.+#L\d+$/.test((await link.getAttribute('href')) ?? ''), 'locations link to GitHub at the scanned commit', await link.getAttribute('href'))

  for (const [label, ext] of [
    ['Markdown', 'md'],
    ['JSON', 'json'],
  ]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()])
    const path = await download.path()
    const text = readFileSync(path, 'utf8')
    check(download.suggestedFilename().endsWith(`.${ext}`) && text.includes('panva/jose') && !/audit/i.test(text), `${label} download`, download.suggestedFilename())
    if (ext === 'json') check(JSON.parse(text).surfaces.length > 3, 'JSON download parses')
  }
  await page.getByRole('button', { name: 'Copy link' }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  check(/\/quantumize\?repo=panva\/jose$/.test(copied), 'Copy link copies the share URL', copied)

  const input = page.locator('#as-repo-input')
  await input.fill('not a repo !!')
  await page.getByRole('button', { name: 'Scan repository' }).click()
  check(await page.locator('.as-error').isVisible(), 'invalid input shows an error')
  await input.fill('nobody-xyz-123/does-not-exist')
  await page.getByRole('button', { name: 'Scan repository' }).click()
  await page.locator('.as-error', { hasText: 'No public repository' }).waitFor({ timeout: 20000 })
  check(true, 'missing repo shows the not-found message')
  await input.fill('https://github.com/anza-xyz/wallet-adapter/tree/master')
  await input.press('Enter')
  await page.locator('.as-report-head', { hasText: 'wallet-adapter' }).waitFor({ timeout: 60000 })
  check(page.url().endsWith('/quantumize?repo=anza-xyz/wallet-adapter&ref=master'), 'GitHub tree URL keeps the branch', page.url())
  await page.getByRole('button', { name: 'paulmillr/noble-post-quantum' }).click()
  await page.locator('.as-report-head', { hasText: 'noble-post-quantum' }).waitFor({ timeout: 60000 })
  check(await page.locator('.as-surface-count b').first().isVisible(), 'example chip runs and shows hybrids')

  // Paste
  await page.getByRole('tab', { name: 'Paste code' }).click()
  await page.getByRole('button', { name: 'Scan code' }).click()
  check(await page.locator('.as-error', { hasText: 'Paste some code' }).isVisible(), 'empty paste shows an error')
  await page.getByRole('button', { name: 'Load a sample' }).click()
  await page.getByRole('button', { name: 'Scan code' }).click()
  await page.locator('.as-report-head', { hasText: 'server.ts' }).waitFor()
  const titles = await page.locator('.as-surface h3').allTextContents()
  check(titles[0]?.startsWith('Elliptic-curve key exchange') && titles.length >= 6, 'pasted sample ranks key exchange first', titles.join(' / '))
  check((await page.getByRole('button', { name: 'Copy link' }).count()) === 0, 'no share link for pasted code')

  // Local folder and files
  const dir = mkdtempSync(join(tmpdir(), 'qf-scan-'))
  const project = join(dir, 'demo-app')
  for (const [path, text] of Object.entries({
    'src/kem.ts': "import { x25519 } from '@noble/curves/ed25519'\nexport const shared = (a, b) => x25519.getSharedSecret(a, b)\nexport const hybrid = combine(ml_kem768, x25519)\n",
    'src/sign.py': 'from cryptography.hazmat.primitives.asymmetric import rsa\nkey = rsa.generate_private_key(public_exponent=65537, key_size=2048)\n',
    'src/server.go': 'import "crypto/ecdsa"\nconfig := &tls.Config{MinVersion: tls.VersionTLS10}\n',
    'package.json': '{"dependencies":{"jsonwebtoken":"9.0.0","@noble/post-quantum":"0.2.0"}}',
    'node_modules/evil/index.js': "createECDH('secp256k1')",
    '.env': 'SECRET=createECDH',
    'test/kem.test.ts': "x25519.getSharedSecret(a, b)",
  })) {
    mkdirSync(join(project, path, '..'), { recursive: true })
    writeFileSync(join(project, path), text)
  }
  await page.getByRole('tab', { name: 'Local folder' }).click()
  await page.locator('.as-drop input[type=file]').first().setInputFiles(project)
  await page.locator('.as-report-head', { hasText: 'demo-app' }).waitFor({ timeout: 20000 })
  const local = await page.evaluate(() => ({
    surfaces: [...document.querySelectorAll('.as-surface h3')].map((h) => h.textContent),
    paths: [...document.querySelectorAll('.as-where')].map((a) => a.textContent),
    links: document.querySelectorAll('.as-locations a').length,
    deps: [...document.querySelectorAll('.as-deps code')].map((c) => c.textContent),
    verdict: document.querySelector('#as-report-title')?.textContent,
  }))
  check(local.surfaces.some((t) => t.includes('key exchange')) && local.surfaces.some((t) => t.includes('RSA')) && local.surfaces.some((t) => t.includes('TLS')), 'folder scan finds ECDH, RSA and TLS', local.surfaces.join(' / '))
  check(!local.paths.some((p) => p.includes('node_modules') || p.includes('.env')), 'folder scan skips node_modules and .env', local.paths.join(' '))
  check(local.paths.every((p) => !p.startsWith('demo-app/')), 'folder paths are relative to the folder', local.paths[0])
  check(local.links === 0, 'local findings do not link to GitHub')
  check(local.deps.includes('jsonwebtoken') && local.deps.includes('@noble/post-quantum'), 'folder scan reads package.json', local.deps.join(' '))
  await page.locator('.as-drop input[type=file]').nth(1).setInputFiles([join(project, 'src/sign.py'), join(project, 'src/server.go')])
  await page.locator('.as-report-head', { hasText: '2 files' }).waitFor({ timeout: 20000 })
  check(true, '"Choose files" scans individual files')

  // Stop a long local scan
  const many = join(dir, 'big')
  mkdirSync(many)
  for (let index = 0; index < 5000; index++) writeFileSync(join(many, `f${index}.ts`), `export const k${index} = createECDH('prime256v1')\n`.repeat(200))
  await page.locator('.as-drop input[type=file]').first().setInputFiles(many)
  const stop = page.getByRole('button', { name: 'Stop' })
  await stop.waitFor({ timeout: 10000 })
  await stop.dispatchEvent('click')
  await page.locator('.as-report-warn', { hasText: 'Stopped' }).waitFor({ timeout: 20000 })
  check(true, 'Stop ends a local scan with a partial report')
  rmSync(dir, { recursive: true, force: true })

  await page.screenshot({ path: `${shots}quantumize.png`, fullPage: false })
  check(errors.length === 0, 'Quantumize flows have no console errors', errors.join(' | '))
  await context.close()
}

/* ---------- Blueprint studio ---------- */
{
  const { context, page, errors } = await open(DESKTOP)
  await page.goto(`${BASE}/blueprints/quantumize-my-app`, { waitUntil: 'networkidle' })
  check(await page.locator('.bp-detail-tags', { hasText: 'AVAILABLE' }).isVisible(), 'Quantumize My App blueprint is AVAILABLE')
  await page.goto(`${BASE}/lab?blueprint=quantumize-my-app`, { waitUntil: 'networkidle' })
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export surface map' }).click()])
  check(download.suggestedFilename() === 'quantumize-my-app.surface-map.json', 'studio exports the surface map')
  await page.getByRole('link', { name: 'Scan my code' }).click()
  await page.waitForURL(/\/quantumize$/)
  check(true, 'studio "Scan my code" opens the scanner')
  check(errors.length === 0, 'studio has no errors', errors.join(' | '))
  await context.close()
}

/* ---------- Lab: up to the real burn ---------- */
{
  const { context, page, errors } = await open(DESKTOP)
  await page.goto(`${BASE}/lab?blueprint=quantum-chain`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Continue/ }).click()
  for (let index = 0; index < 8; index++) {
    const next = page.locator('.step-nav .btn-primary')
    if (!(await next.count()) || (await next.isDisabled())) break
    await next.click()
    await page.waitForTimeout(300)
  }
  const text = await page.locator('body').innerText()
  check(!/RUN SIMULATED REACTION|simulated reaction/i.test(text), 'lab offers no simulated reaction')
  check(/devnet|wallet|switched off|unavailable/i.test(text), 'lab stops at a real step: wallet, devnet burn, or the reason it is off', text.slice(0, 200))
  check((await page.locator('.hold').count()) === 0, 'nothing can be burned without a wallet')
  await page.screenshot({ path: `${shots}lab-burn.png` })
  check(errors.length === 0, 'lab has no errors', errors.join(' | '))
  await context.close()
}

await browser.close()
console.log(notes.join('\n'))
console.log(failures.length ? `\n${failures.join('\n')}\n\n${failures.length} failed, ${notes.length} passed` : `\nall ${notes.length} checks passed`)
process.exit(failures.length ? 1 : 0)
