// Renders .recording/promo/index.html frame by frame into recordings/quantum-fork-promo.mp4.
// Needs the Vite dev server (npm run dev) on BASE.
//   node .recording/promo/render.mjs                 full 30s render
//   node .recording/promo/render.mjs --stills 1,5,20 preview frames into .recording/promo/stills
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const FPS = 30
const stillsArg = process.argv.indexOf('--stills')
const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(',').map(Number) : null
const root = new URL('../../', import.meta.url).pathname
const target = process.env.OUT ?? `${root}recordings/quantum-fork-promo.mp4`

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
await page.clock.install({ time: new Date('2026-10-15T12:00:00Z') })
await page.goto(`${BASE}/.recording/promo/index.html`, { waitUntil: 'load' })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
for (let tries = 0; !(await page.evaluate(() => window.promoReady === true)); tries += 1) {
  if (tries > 200) throw new Error(`composition never became ready: ${errors.join(' | ')}`)
  await page.clock.runFor(50)
  await sleep(50)
}
const duration = await page.evaluate(() => window.DURATION)
const frames = Math.round(duration * FPS)

let ffmpeg = null
if (!stills) {
  mkdirSync(`${root}recordings`, { recursive: true })
  ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-movflags', '+faststart', target], { stdio: ['pipe', 'inherit', 'inherit'] })
} else {
  mkdirSync(new URL('./stills/', import.meta.url).pathname, { recursive: true })
}

const wanted = new Set((stills ?? []).map((s) => Math.round(s * FPS)))
const started = Date.now()
for (let frame = 0; frame < frames; frame += 1) {
  const t = frame / FPS
  await page.evaluate((time) => window.seek(time), t)
  await page.clock.runFor(1000 / FPS)
  if (stills) {
    if (!wanted.has(frame)) continue
    await page.screenshot({ path: new URL(`./stills/t${t.toFixed(2)}.png`, import.meta.url).pathname })
    console.log('still', t.toFixed(2))
    continue
  }
  const png = await page.screenshot({ type: 'png' })
  if (!ffmpeg.stdin.write(png)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve))
  if (frame % 90 === 0) console.log(`frame ${frame}/${frames} · ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

if (ffmpeg) {
  ffmpeg.stdin.end()
  await new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))))
  console.log('wrote', target)
}
if (errors.length) console.log('page errors:', errors.join(' | '))
await browser.close()
