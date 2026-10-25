// 30s promo composition. Every frame is a pure function of `t` (seconds) plus the three.js organism,
// whose clock is driven by Playwright's fake timers in render.mjs, so the capture is frame-exact.
import { blueprintVisual } from '/src/lab/blueprintVisual'
import { BLUEPRINT_BY_SLUG } from '/src/protocol/blueprints'
import type { LayerSpec } from '/src/protocol/networkLayers'
import { mountSpecimen } from '/src/three/viewport'

declare global {
  interface Window {
    seek: (t: number) => void
    promoReady: boolean
    DURATION: number
  }
}

const DURATION = 30
const INTRO = 3.6
const BEAT = 4.56
const OUTRO = INTRO + BEAT * 5

const LIME = '#c8ff4d'
const CYAN = '#4fe3ff'
const PURPLE = '#9d7bff'
const RED = '#ff4d5e'
const GREEN = '#3dffa0'
const YELLOW = '#ffd54a'
const MUTED = '#8d8c88'

interface Beat {
  pill: string
  tone: string
  title: string
  body: string
  foot?: string
  shot?: string
  url?: string
  tall?: boolean
  pan?: [number, number]
  zoom?: [number, number]
  origin?: string
}

const BEATS: Beat[] = [
  {
    pill: 'Blueprints',
    tone: LIME,
    title: 'Pick what<br><span>to build.</span>',
    body: 'Chains, payments, private networks. Each blueprint picks the cryptography for you.',
    shot: 'blueprints',
    url: 'quantumfork.wtf/blueprints',
    tall: true,
    pan: [0, 0.78],
    zoom: [1, 1.03],
  },
  {
    pill: 'Scanner',
    tone: RED,
    title: 'See what<br><span>quantum breaks.</span>',
    body: 'Solana’s cryptography, mapped piece by piece. Every finding cites its source.',
    shot: 'scanner',
    url: 'quantumfork.wtf/scanner',
    tall: true,
    pan: [0.12, 0.3],
    zoom: [1, 1.1],
    origin: '78% 30%',
  },
  {
    pill: 'Lab',
    tone: CYAN,
    title: 'Run <span>genesis.</span>',
    body: 'Configure the genome, review every change, then bring your network to life.',
    foot: 'Simulated in demo mode · nothing burned',
    shot: 'genesis',
    url: 'quantumfork.wtf/lab',
    zoom: [1.02, 1.12],
    origin: '50% 62%',
  },
  {
    pill: 'Network console',
    tone: PURPLE,
    title: 'Genesis is<br><span>the beginning.</span>',
    body: 'Issue assets, deploy apps and open vaults on your own network.',
    foot: 'Simulated adapters · not live on mainnet',
    shot: 'console',
    url: 'quantumfork.wtf/network',
    tall: true,
    pan: [0, 0.34],
    zoom: [1, 1.03],
  },
  {
    pill: 'Live organism',
    tone: GREEN,
    title: 'Watch it <span>grow.</span>',
    body: 'Every asset, app and vault adds a structure to your network you can see.',
  },
]

interface System {
  label: string
  status: string
  tone: string
  x: number
  y: number
  at: number
  adds: LayerSpec[]
}

const SYSTEMS: System[] = [
  { label: 'Assets', status: 'Demo', tone: LIME, x: 1540, y: 236, at: 0.5, adds: [{ key: 'orbit:a', kind: 'orbit', seed: 11, index: 0 }, { key: 'orbit:b', kind: 'orbit', seed: 29, index: 1 }] },
  { label: 'Vault', status: 'Demo', tone: CYAN, x: 1610, y: 500, at: 1.15, adds: [{ key: 'vault', kind: 'vault', seed: 0, index: 0, count: 1, activity: 0.85 }] },
  { label: 'Markets', status: 'Coming soon', tone: MUTED, x: 1520, y: 790, at: 1.8, adds: [{ key: 'payments', kind: 'payments', seed: 0, index: 0, activity: 0.5 }] },
  { label: 'Developers', status: 'Available', tone: GREEN, x: 860, y: 800, at: 2.45, adds: [{ key: 'agents:3', kind: 'agents', seed: 0, index: 0, count: 3, activity: 0.5 }] },
  { label: 'Evolution', status: 'Demo', tone: YELLOW, x: 880, y: 250, at: 3.1, adds: [{ key: 'membrane', kind: 'membrane', seed: 0, index: 0, activity: 0.6 }, { key: 'bud:0', kind: 'bud', seed: 83, index: 0 }] },
]

/* ---------- easing ---------- */
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
const ramp = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const out3 = (x: number) => 1 - (1 - x) ** 3
const in2 = (x: number) => x * x
const inOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)
const back = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2

const $ = <T extends HTMLElement | SVGElement = HTMLElement>(selector: string) => document.querySelector(selector) as T
const style = (el: HTMLElement | SVGElement, opacity: number, transform = '', blur = 0) => {
  el.style.opacity = String(clamp(opacity))
  el.style.transform = transform
  el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : ''
}

/* ---------- build DOM ---------- */
const lock = '<svg viewBox="0 0 16 16" fill="none"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" stroke-width="1.4"/></svg>'
const beatsEl = $('#beats')
const windowsEl = $('#windows')
BEATS.forEach((beat, index) => {
  const section = document.createElement('section')
  section.className = 'beat'
  section.style.setProperty('--tone', beat.tone)
  section.innerHTML = `<span class="pill">${beat.pill}</span><h2>${beat.title}</h2><p>${beat.body}</p>${beat.foot ? `<small>${beat.foot}</small>` : ''}`
  if (index === 4) section.style.width = '640px'
  beatsEl.appendChild(section)
  if (!beat.shot) return
  const win = document.createElement('div')
  win.className = 'window'
  win.style.setProperty('--tone', beat.tone)
  win.innerHTML = `<div class="bar"><i></i><i></i><i></i><span class="url">${lock}${beat.url}</span></div><div class="view"><img src="./shots/${beat.shot}.png" alt=""></div>`
  win.dataset.beat = String(index)
  windowsEl.appendChild(win)
})
const systemsEl = $('#systems')
for (const system of SYSTEMS) {
  const li = document.createElement('li')
  li.style.setProperty('--tone', system.tone)
  li.style.left = `${system.x}px`
  li.style.top = `${system.y}px`
  li.innerHTML = `<b></b>${system.label}<em>${system.status}</em>`
  systemsEl.appendChild(li)
}
const dotsEl = $('#dots')
for (let index = 0; index < 5; index += 1) dotsEl.appendChild(document.createElement('i'))
const word = $('#word')
word.innerHTML = [...'Quantum Fork'].map((ch) => (ch === ' ' ? '<i>&nbsp;</i>' : `<i>${ch}</i>`)).join('')

/* ---------- organism ---------- */
const visual = blueprintVisual(BLUEPRINT_BY_SLUG['quantum-chain'])
const canvas = document.getElementById('organism') as HTMLCanvasElement
const organism = mountSpecimen(canvas, { genome: visual.genome, fx: visual.fx, layers: [], zoom: 0.94, interactive: false })

const events: { at: number; run: () => void }[] = [
  { at: 0, run: () => organism.setMode('mutate', 0xc8ff4d) },
  { at: 0.75, run: () => organism.setMode('idle') },
]
let grown: LayerSpec[] = []
for (const system of SYSTEMS) {
  events.push({
    at: OUTRO - BEAT + system.at,
    run: () => {
      grown = [...grown, ...system.adds]
      organism.setLayers(grown)
    },
  })
}
events.sort((a, b) => a.at - b.at)
let fired = 0

/* ---------- timeline ---------- */
const beatStart = (index: number) => INTRO + index * BEAT

function seek(t: number) {
  while (fired < events.length && events[fired].at <= t) events[fired++].run()

  /* background drift */
  const clouds = document.querySelectorAll<HTMLElement>('.cloud')
  clouds[0].style.transform = `translate(${Math.sin(t * 0.21) * 110}px, ${Math.cos(t * 0.17) * 70}px)`
  clouds[1].style.transform = `translate(${Math.cos(t * 0.19) * -120}px, ${Math.sin(t * 0.23) * 80}px)`
  clouds[2].style.transform = `translate(${Math.sin(t * 0.15 + 1) * 160}px, ${Math.cos(t * 0.13) * 90}px)`
  $('.grid').style.transform = `translate(${(t * 4) % 34}px, ${(t * 2.5) % 34}px)`

  /* intro: the chain forks into ψ, then the name */
  const intro = $('#intro')
  const introOut = in2(ramp(t, 3.1, 3.65))
  style(intro, 1 - introOut, `scale(${1 - introOut * 0.05})`, introOut * 14)
  const stem = out3(ramp(t, 0.3, 1.0))
  const arms = out3(ramp(t, 0.85, 1.5))
  const draw = (selector: string, k: number) =>
    document.querySelectorAll<SVGPathElement>(selector).forEach((path) => {
      path.style.strokeDashoffset = String(1 - k)
      path.style.opacity = k > 0.002 ? '1' : '0'
    })
  draw('#bigmark .stem', stem)
  draw('#bigmark .arm-l, #bigmark .arm-r', arms)
  const rise = inOut(ramp(t, 1.55, 2.2))
  const pulse = Math.exp(-(((t - 1.55) / 0.22) ** 2))
  const mark = $('#bigmark')
  mark.style.transform = `translateY(${lerp(116, 0, rise)}px) scale(${lerp(1.25, 1, rise) + pulse * 0.04})`
  mark.style.filter = `drop-shadow(0 0 ${(14 + pulse * 40).toFixed(1)}px rgba(200,255,77,${(0.25 + pulse * 0.45).toFixed(2)}))`
  word.querySelectorAll<HTMLElement>('i').forEach((letter, index) => {
    const k = out3(ramp(t, 1.8 + index * 0.035, 2.3 + index * 0.035))
    style(letter, k, `translateY(${(1 - k) * 34}px)`, (1 - k) * 12)
  })
  const tag = out3(ramp(t, 2.35, 2.95))
  style($('#tag'), tag, `translateY(${(1 - tag) * 24}px)`, (1 - tag) * 10)

  /* chrome shared by the feature beats */
  const chromeIn = out3(ramp(t, 3.45, 4.0))
  const chromeOut = in2(ramp(t, OUTRO - 0.35, OUTRO + 0.1))
  style($('#lockup'), chromeIn * (1 - chromeOut), `translateY(${(1 - chromeIn) * -16}px)`)
  style($('#dots'), chromeIn * (1 - chromeOut))

  /* feature beats */
  const sections = document.querySelectorAll<HTMLElement>('.beat')
  const dots = dotsEl.querySelectorAll<HTMLElement>('i')
  BEATS.forEach((beat, index) => {
    const s = beatStart(index)
    const e = s + BEAT
    const section = sections[index]
    const inside = t > s - 0.4 && t < e + 0.3
    section.style.opacity = inside ? '1' : '0'
    if (inside) {
      ;[...section.children].forEach((child, order) => {
        const a = out3(ramp(t, s - 0.18 + order * 0.07, s + 0.52 + order * 0.07))
        const b = in2(ramp(t, e - 0.42 + order * 0.03, e + 0.04 + order * 0.03))
        style(child as HTMLElement, a * (1 - b), `translateY(${(1 - a) * 44 - b * 26}px)`, (1 - a) * 10 + b * 8)
      })
    }
    const active = clamp(ramp(t, s - 0.1, s + 0.4) - ramp(t, e - 0.1, e + 0.4))
    dots[index].style.width = `${8 + active * 34}px`
    dots[index].style.background = active > 0.5 ? beat.tone : 'rgba(236,234,228,.22)'
  })

  /* browser windows */
  document.querySelectorAll<HTMLElement>('.window').forEach((win) => {
    const index = Number(win.dataset.beat)
    const beat = BEATS[index]
    const s = beatStart(index)
    const e = s + BEAT
    const a = out3(ramp(t, s - 0.3, s + 0.7))
    const b = in2(ramp(t, e - 0.45, e + 0.1))
    style(
      win,
      a * (1 - b),
      `perspective(2400px) translateX(${(1 - a) * 170 - b * 60}px) rotateY(${-(3.5 + (1 - a) * 11)}deg) scale(${0.95 + 0.05 * a + b * 0.03})`,
      (1 - a) * 16 + b * 12,
    )
    const img = win.querySelector('img') as HTMLImageElement
    const u = inOut(ramp(t, s + 0.55, e - 0.15))
    const range = beat.tall ? (1500 * 1060) / 1440 - 662 : 0
    const pan = lerp(beat.pan?.[0] ?? 0, beat.pan?.[1] ?? 0, u) * range
    const zoom = lerp(beat.zoom?.[0] ?? 1, beat.zoom?.[1] ?? 1, u)
    img.style.transformOrigin = beat.origin ?? '50% 0'
    img.style.transform = `translateY(${-pan}px) scale(${zoom})`
  })

  /* the organism: forms in the intro, grows in the last beat, sits behind the end card */
  const formIn = out3(ramp(t, 0, 0.8))
  const recede = inOut(ramp(t, 0.7, 1.4))
  const introGone = ramp(t, 3.0, 3.6)
  let opacity = formIn * lerp(0.8, 0.13, recede) * (1 - introGone)
  let x = 0
  let scale = lerp(0.8, 1, formIn) + recede * 0.24
  let y = 0
  const g = beatStart(4)
  if (t > g - 0.3) {
    const k = out3(ramp(t, g - 0.1, g + 0.8))
    const o = inOut(ramp(t, OUTRO - 0.3, OUTRO + 0.9))
    opacity = k * lerp(1, 0.32, o)
    x = lerp(330, 0, o) + (1 - k) * 80
    scale = lerp(lerp(0.74, 0.8, k), 1.25, o)
    y = lerp(0, -30, o)
  }
  canvas.style.opacity = String(clamp(opacity))
  canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  canvas.style.filter = 'brightness(0.78) contrast(1.06)'

  systemsEl.querySelectorAll<HTMLElement>('li').forEach((li, index) => {
    const at = g + SYSTEMS[index].at
    const k = back(ramp(t, at - 0.05, at + 0.45))
    const gone = in2(ramp(t, OUTRO - 0.4, OUTRO))
    style(li, clamp(ramp(t, at - 0.05, at + 0.25)) * (1 - gone), `translateY(${(1 - k) * 18}px) scale(${0.85 + 0.15 * k})`, (1 - clamp(k)) * 6 + gone * 8)
  })

  /* end card */
  const outro = $('#outro')
  outro.style.opacity = t > OUTRO - 0.1 ? '1' : '0'
  ;[...outro.children].forEach((child, order) => {
    const k = out3(ramp(t, OUTRO + 0.15 + order * 0.14, OUTRO + 0.85 + order * 0.14))
    const pop = order === 0 ? back(ramp(t, OUTRO + 0.15, OUTRO + 0.85)) : k
    style(child as HTMLElement, k, `translateY(${(1 - k) * 36}px) scale(${order === 0 ? 0.7 + 0.3 * pop : 1})`, (1 - k) * 12)
  })
}

window.seek = seek
window.DURATION = DURATION
seek(0)

const images = [...document.images].map((img) => img.decode().catch(() => undefined))
Promise.all([document.fonts.ready, ...images]).then(() => {
  window.promoReady = true
})
