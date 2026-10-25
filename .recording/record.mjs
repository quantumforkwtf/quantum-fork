import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:5173'
const FRAMES = join(import.meta.dirname, 'frames')
const VIEW = { width: 1600, height: 900 }
const SCALE = 1.2

rmSync(FRAMES, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })

const overlayScript = () => {
  const install = () => {
    if (document.getElementById('agent-cursor')) return
    const style = document.createElement('style')
    style.textContent = `
      #agent-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 30px; height: 30px; transform: translate(-100px, -100px); transition: none; }
      #agent-cursor svg { width: 30px; height: 30px; filter: drop-shadow(2px 3px 0 rgba(22,19,15,.35)); transition: transform 120ms ease-out; transform-origin: 4px 3px; }
      #agent-cursor.down svg { transform: scale(.82); }
      .agent-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 3px solid #B9F03C; box-shadow: 0 0 0 2px #16130F; animation: agent-ripple 520ms ease-out forwards; }
      @keyframes agent-ripple { to { transform: scale(4.2); opacity: 0; } }
      #agent-caption { position: fixed; left: 28px; bottom: 26px; z-index: 2147483645; pointer-events: none; display: flex; align-items: stretch; max-width: 760px; font: 600 15px/1.35 'IBM Plex Mono', ui-monospace, monospace; letter-spacing: .04em; text-transform: uppercase; color: #FBF7EE; background: #16130F; border: 3px solid #16130F; border-radius: 14px; box-shadow: 6px 6px 0 #B9F03C; overflow: hidden; opacity: 0; transform: translateY(16px); transition: opacity 260ms ease, transform 360ms cubic-bezier(.34,1.56,.64,1); }
      #agent-caption.on { opacity: 1; transform: none; }
      #agent-caption b { display: grid; place-items: center; padding: 0 12px; background: #B9F03C; color: #16130F; font-weight: 700; font-size: 12px; letter-spacing: .14em; white-space: nowrap; }
      #agent-caption span { padding: 12px 16px; }
      #agent-card { position: fixed; inset: 0; z-index: 2147483640; display: grid; place-content: center; justify-items: center; gap: 18px; text-align: center; background-color: #16130F; background-image: radial-gradient(rgba(185,240,60,.14) 1px, transparent 1.6px); background-size: 9px 9px; color: #FBF7EE; opacity: 0; pointer-events: none; transition: opacity 600ms ease; }
      #agent-card.on { opacity: 1; }
      #agent-card .k { font: 600 14px 'IBM Plex Mono', monospace; letter-spacing: .3em; color: #B9F03C; }
      #agent-card h1 { margin: 0; font: 900 112px/0.9 'Archivo', sans-serif; font-stretch: 125%; letter-spacing: -.01em; }
      #agent-card h1 em { font-style: normal; color: #16130F; background: #B9F03C; padding: 0 .12em; }
      #agent-card p { margin: 0; font: 500 16px 'IBM Plex Mono', monospace; letter-spacing: .12em; color: #c9c2b2; }
      #agent-card .tag { margin-top: 10px; padding: 6px 12px; border: 2px solid #F6C431; color: #F6C431; border-radius: 6px; font: 600 12px 'IBM Plex Mono', monospace; letter-spacing: .2em; }
    `
    document.head.appendChild(style)

    const cursor = document.createElement('div')
    cursor.id = 'agent-cursor'
    cursor.innerHTML = `<svg viewBox="0 0 30 30"><path d="M4 3 L4 24 L9.5 18.6 L13.4 27 L17.4 25.2 L13.6 17 L21.5 17 Z" fill="#16130F" stroke="#FBF7EE" stroke-width="2" stroke-linejoin="round"/></svg>`
    document.body.appendChild(cursor)

    const caption = document.createElement('div')
    caption.id = 'agent-caption'
    caption.innerHTML = '<b>LAB AGENT</b><span></span>'
    document.body.appendChild(caption)

    const card = document.createElement('div')
    card.id = 'agent-card'
    document.body.appendChild(card)

    window.addEventListener('mousemove', (e) => { cursor.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 3}px)` }, true)
    window.addEventListener('mousedown', (e) => {
      cursor.classList.add('down')
      const ripple = document.createElement('i')
      ripple.className = 'agent-ripple'
      ripple.style.left = `${e.clientX}px`
      ripple.style.top = `${e.clientY}px`
      document.body.appendChild(ripple)
      setTimeout(() => ripple.remove(), 600)
    }, true)
    window.addEventListener('mouseup', () => cursor.classList.remove('down'), true)

    window.__caption = (text) => {
      const span = caption.querySelector('span')
      if (!text) { caption.classList.remove('on'); return }
      caption.classList.remove('on')
      setTimeout(() => { span.textContent = text; caption.classList.add('on') }, caption.classList.contains('on') ? 180 : 0)
    }
    window.__card = (html) => {
      if (!html) { card.classList.remove('on'); return }
      card.innerHTML = html
      card.classList.add('on')
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install)
  else install()
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] })
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, reducedMotion: 'no-preference' })
await context.addInitScript(overlayScript)
const page = await context.newPage()

const cdp = await context.newCDPSession(page)
const frames = []
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = join(FRAMES, `f${String(frames.length).padStart(6, '0')}.jpg`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  frames.push({ file, t: metadata.timestamp })
  try {
    await cdp.send('Page.screencastFrameAck', { sessionId })
  } catch {}
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let mouse = { x: VIEW.width / 2, y: VIEW.height / 2 }

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

async function moveTo(x, y, ms) {
  const dist = Math.hypot(x - mouse.x, y - mouse.y)
  const duration = ms ?? Math.min(900, 260 + dist * 0.75)
  const steps = Math.max(8, Math.round(duration / 16))
  const from = { ...mouse }
  const bend = (Math.random() - 0.5) * Math.min(120, dist * 0.25)
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps)
    const arc = Math.sin(Math.PI * t) * bend
    const nx = -(y - from.y) / (dist || 1)
    const ny = (x - from.x) / (dist || 1)
    await page.mouse.move(from.x + (x - from.x) * t + nx * arc, from.y + (y - from.y) * t + ny * arc)
    await sleep(duration / steps)
  }
  mouse = { x, y }
}

async function scrollToY(target, ms = 1100) {
  const start = await page.evaluate(() => window.scrollY)
  const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
  const end = Math.max(0, Math.min(max, target))
  const steps = Math.max(10, Math.round(ms / 16))
  for (let i = 1; i <= steps; i++) {
    const y = start + (end - start) * ease(i / steps)
    await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), y)
    await sleep(ms / steps)
  }
}

async function scrollToEl(locator, { block = 'center', offset = 0, ms } = {}) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator
  await el.waitFor({ state: 'attached' })
  const y = await el.evaluate((node, block) => {
    const rect = node.getBoundingClientRect()
    const top = rect.top + window.scrollY
    if (block === 'start') return top - 100
    return top + rect.height / 2 - window.innerHeight / 2
  }, block)
  const now = await page.evaluate(() => window.scrollY)
  await scrollToY(y + offset, ms ?? Math.min(1600, 500 + Math.abs(y + offset - now) * 0.45))
}

async function ensureVisible(el) {
  const box = await el.boundingBox()
  if (!box) throw new Error('no box')
  if (box.y < 100 || box.y + box.height > VIEW.height - 40) {
    await scrollToEl(el)
    await sleep(200)
  }
  return el.boundingBox()
}

async function hover(locator, { dx = 0, dy = 0, pause = 500 } = {}) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator
  const box = await ensureVisible(el)
  await moveTo(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy)
  await sleep(pause)
}

async function click(locator, { pause = 450, dx = 0, dy = 0 } = {}) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator
  const box = await ensureVisible(el)
  await moveTo(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy)
  await sleep(140)
  await page.mouse.down()
  await sleep(90)
  await page.mouse.up()
  await sleep(pause)
}

async function dragFader(label, value, min, max) {
  const input = page.locator('.fader').filter({ hasText: label }).locator('input')
  const box = await ensureVisible(input)
  const current = Number(await input.inputValue())
  const xFor = (v) => box.x + 15 + ((v - min) / (max - min)) * (box.width - 30)
  const y = box.y + box.height / 2
  await moveTo(xFor(current), y)
  await sleep(120)
  await page.mouse.down()
  await moveTo(xFor(value), y, 700)
  await page.mouse.up()
  await sleep(350)
}

async function typeInto(locator, text) {
  const el = page.locator(locator).first()
  await click(el, { pause: 150 })
  await page.keyboard.press('ControlOrMeta+A')
  await sleep(120)
  await page.keyboard.press('Backspace')
  await sleep(200)
  await page.keyboard.type(text, { delay: 110 })
  await sleep(300)
}

const caption = (text) => page.evaluate((t) => window.__caption(t), text)
const card = (html) => page.evaluate((h) => window.__card(h), html)
const radio = (name) => page.getByRole('radio', { name, exact: true })
const button = (name) => page.getByRole('button', { name, exact: true })

// ------------------------------------------------------------------ session

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await card(`<span class="k">QUANTUM FORK RESEARCH DIVISION · QF/LAB-01</span><h1>LAB SESSION <em>001</em></h1><p>AN AGENT AT THE CONTROLS. BURN QFORK. CREATE SPECIES.</p><span class="tag">DEMO LAB · SIMULATED BURNS</span>`)
await sleep(300)

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
await sleep(2600)
await card(null)
await page.mouse.move(mouse.x, mouse.y)
await sleep(900)

// 1 · the reactor
await caption('THE QUANTUM REACTOR. $QFORK GOES IN, A NEW BLOCKCHAIN COMES OUT.')
await scrollToEl('.hero-rig', { offset: 40 })
await hover('.rx-coin', { pause: 700 })
await caption('FEEDING ONE UNIT OF $QFORK INTO THE HOPPER…')
{
  const coin = await page.locator('.rx-coin').boundingBox()
  const hopper = await page.locator('.rx-hopper').boundingBox()
  await page.mouse.down()
  await sleep(200)
  await moveTo(coin.x + coin.width / 2 + 70, coin.y - 30, 450)
  await moveTo(hopper.x + hopper.width / 2, hopper.y + hopper.height * 0.45, 650)
  await sleep(250)
  await page.mouse.up()
}
await sleep(1400)
await caption('SEALED. CHARGING. DISINTEGRATING. THE GENOME REASSEMBLES IN THE GENESIS CHAMBER.')
await page.waitForFunction(() => document.querySelector('.reactor')?.dataset.phase === 'complete', null, { timeout: 15000 })
await hover('.rx-jar', { pause: 600 })
const discovered = await page.locator('.rx-monitor').innerText()
console.log('reactor:', discovered.replace(/\n/g, ' / '))
await caption('NEW SPECIES DISCOVERED. NETWORK ONLINE.')
await sleep(2400)

// 2 · burn counter + DNA
await caption('EVERY GENESIS, MUTATION AND FORK DESTROYS QFORK FOR GOOD.')
await scrollToEl('.burn-counter')
await sleep(2600)

await caption('CRYPTOGRAPHY IS DNA. EACH GENE MAPS TO AN ORGAN ON THE CREATURE.')
await scrollToEl('.section.dna', { block: 'start', offset: 40 })
await sleep(600)
const dnaGenes = page.locator('.section.dna .genome-viz li')
for (const index of [0, 5, 6, 3]) {
  await hover(dnaGenes.nth(index), { pause: 650 })
}
await caption('SHADOW → SHADOW DARK → SHADOW DARK PQ. SAME FAMILY, DIVERGING DNA.')
await click(page.getByRole('tab').nth(1), { pause: 1100 })
await click(page.getByRole('tab').nth(2), { pause: 900 })
await hover(dnaGenes.nth(5), { pause: 900 })

await caption('THE MUTATION CATALOGUE. NOTHING HERE IS MARKED AUDITED, BECAUSE NOTHING IS.')
await scrollToEl('.section.mutations', { block: 'start', offset: 60 })
await hover('.section.mutations .mutation-card >> nth=0', { pause: 700 })
await hover('.section.mutations .mutation-card >> nth=6', { pause: 1100 })

// 3 · the lab
await caption("TIME TO BUILD ONE. ENTERING THE LAB.")
await scrollToY(0, 1200)
await click(page.locator('.nav').getByRole('link', { name: 'ENTER THE LAB', exact: true }), { pause: 1200 })
await page.waitForURL('**/create')
await sleep(600)

await caption('STATION 01 · IDENTITY. NAMING THE SPECIMEN.')
await typeInto('.tape-lg input', 'AURORA')
await click(radio('21M'), { pause: 600 })

await caption('STATION 02 · EXECUTION. WASM RUNTIME, TURBO BLOCKS, A WIDER VALIDATOR SET.')
await scrollToEl('#station-2', { block: 'start' })
await click(radio('WASM'), { pause: 900 })
await click(radio('TURBO'), { pause: 900 })
await dragFader('VALIDATOR SLOTS', 64, 4, 128)
await click(page.getByRole('switch', { name: /ORACLE/ }), { pause: 400 })
await click(page.getByRole('switch', { name: /GOVERNANCE/ }), { pause: 700 })

await caption('STATION 03 · PRIVACY. SHIELDING THE NUCLEUS.')
await scrollToEl('#station-3', { block: 'start' })
await click(radio('SHIELDED'), { pause: 1300 })

await caption('STATION 04 · CRYPTOGRAPHIC DNA. SPLICING IN HYBRID POST-QUANTUM SIGNATURES: ED25519 + ML-DSA-65.')
await scrollToEl('#station-4', { block: 'start' })
await click(radio('HYBRID'), { pause: 1300 })
const labGenes = page.locator('#station-4 .genome-viz li')
for (const index of [0, 5, 3, 1]) {
  await hover(labGenes.nth(index), { pause: 700 })
}

await caption('STATION 05 · ECONOMICS. MORE FEE BURN, A SMALL TREASURY.')
await scrollToEl('#station-5', { block: 'start' })
await dragFader('FEE BURN', 60, 0, 100)
await dragFader('TREASURY SHARE', 15, 0, 30)

await caption('STATION 06 · RECOVERY. 3-OF-5 GUARDIAN THRESHOLD.')
await scrollToEl('#station-6', { block: 'start' })
await click(radio('THRESHOLD'), { pause: 1200 })

await caption('STATION 07 · GENESIS. 125,000 QFORK REQUIRED. THIS DESTROYS IT PERMANENTLY.')
await scrollToEl('#station-7', { block: 'start' })
await sleep(900)
await click(button('CONNECT DEMO WALLET'), { pause: 700 })
await click('.burn-xl', { pause: 1100 })
await caption('CONFIRMING THE BURN. IN THE DEMO LAB NO TRANSACTION IS ACTUALLY SENT.')
await sleep(900)
await click(button('SIGN & BURN'), { pause: 300 })
await caption('GENESIS IN PROGRESS…')
await moveTo(VIEW.width - 120, VIEW.height - 140, 700)
await page.waitForSelector('.chamber-result.is-shown', { timeout: 30000 })
await caption('AURORA IS ALIVE. GEN-0. A QUANTUM-RESISTANT BLOCKCHAIN.')
await sleep(2600)
await click(page.locator('.chamber-result').getByRole('button', { name: 'VIEW SPECIES' }), { pause: 1200 })

// 4 · specimen: mutate
const specimenUrl = page.url()
console.log('specimen:', specimenUrl)
await caption('SPECIMEN PROFILE. EVERY GENE, BURN AND ANCESTOR ON RECORD.')
await sleep(1200)
await scrollToEl('.specimen-actions', { offset: -120 })
await sleep(800)
await caption('MUTATION: LATTICE CORE. DROPS CLASSICAL SIGNATURES ENTIRELY. FULL POST-QUANTUM SUITE.')
await click(button('MUTATE'), { pause: 1300 })
const lattice = page.locator('.mutation-card').filter({ hasText: 'LATTICE CORE' })
await scrollToEl(lattice)
await hover(lattice.locator('h3'), { pause: 900 })
await click(lattice.getByRole('button', { name: /MUTATE/ }), { pause: 300 })
await page.locator('.overlay').getByText('MUTATION SUCCESSFUL').waitFor({ timeout: 15000 })
await caption('MUTATION SUCCESSFUL. AURORA → AURORA X. NEW GENOME WRITTEN.')
await sleep(2800)
await click(button('CLOSE'), { pause: 900 })

// 5 · fork
await caption('NOW A FORK. THE PARENT STAYS UNTOUCHED; THE DESCENDANT GETS NEW GENES.')
await scrollToEl('.specimen-actions', { offset: -120 })
await click(page.locator('.specimen-actions').getByRole('button', { name: /FORK/ }), { pause: 1300 })
const genes = page.locator('.fork-genes .mutation-card')
await scrollToEl('.fork-genes', { block: 'start' })
await click(genes.filter({ hasText: 'DARK STATE' }).locator('.mc-select'), { pause: 700 })
await click(genes.filter({ hasText: 'DEADMAN GENE' }).locator('.mc-select'), { pause: 700 })
await caption('SELECTED: DARK STATE + DEADMAN GENE. WATCH THE DIVERGENCE CLIMB.')
await scrollToEl('.fork-preview', { block: 'start' })
await sleep(1600)
await click('.fork-preview .burn-xl', { pause: 300 })
await caption('FORKING…')
await page.locator('.overlay').getByText('NEW DESCENDANT DISCOVERED').waitFor({ timeout: 20000 })
await caption('NEW DESCENDANT DISCOVERED. GEN-1.')
await sleep(3000)
await click(button('VIEW DESCENDANT'), { pause: 1400 })

await caption('THE FAMILY TREE GROWS.')
await scrollToEl('.lineage-strip')
await sleep(2200)

// 6 · explorer
await caption('THE SPECIES EXPLORER. EVERY CHAIN, EVERY ANCESTOR.')
await scrollToY(0, 900)
await click(page.locator('.nav').getByRole('link', { name: 'SPECIES', exact: true }), { pause: 1200 })
await scrollToEl('.tree-board', { block: 'start', offset: 40 })
await sleep(600)
for (const name of ['AURORA', 'AURORA X', 'AURORA X II']) {
  const node = page.locator('.tree-node').filter({ has: page.getByText(name, { exact: true }) }).first()
  if (await node.count()) await hover(node, { pause: 1100 })
}
await sleep(800)

// 7 · token
await caption('$QFORK. THE RAW MATERIAL OF BLOCKCHAIN EVOLUTION.')
await scrollToY(0, 900)
await click(page.locator('.nav').getByRole('link', { name: '$QFORK', exact: true }), { pause: 900 })
await hover('.token-coin', { dx: -60, dy: -40, pause: 500 })
await hover('.token-coin', { dx: 70, dy: 50, pause: 900 })
await caption(null)
await scrollToEl('.final-word', { ms: 2600 })
await sleep(2200)

await card(`<span class="k">THE BLOCKCHAIN GENETICS PROTOCOL</span><h1>BURN QFORK.<br/>CREATE <em>SPECIES.</em></h1><p>EVOLVE BLOCKCHAINS.</p><span class="tag">DEMO LAB · NO REAL QFORK WAS BURNED · NOTHING IS AUDITED</span>`)
await sleep(3400)

await cdp.send('Page.stopScreencast')
await sleep(300)
await browser.close()

const lines = []
for (let i = 0; i < frames.length; i++) {
  const next = frames[i + 1]?.t ?? frames[i].t + 1 / 30
  lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`)
}
lines.push(`file '${frames[frames.length - 1].file}'`)
writeFileSync(join(import.meta.dirname, 'frames.txt'), lines.join('\n'))
console.log('frames:', frames.length, 'seconds:', (frames.at(-1).t - frames[0].t).toFixed(1))
