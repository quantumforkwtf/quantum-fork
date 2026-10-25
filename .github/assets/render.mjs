// Renders the animated SVGs used by README.md: `node .github/assets/render.mjs`
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))

const C = {
  bg: '#060708',
  card: '#0b0c0e',
  block: '#0f1113',
  text: '#eceae4',
  muted: '#a3a29d',
  faint: '#5a5b5c',
  lime: '#c8ff4d',
  green: '#3dffa0',
  cyan: '#4fe3ff',
  purple: '#9d7bff',
  yellow: '#ffd54a',
  red: '#ff4d5e',
  orange: '#ff7a3c',
}

const BASE_CSS = `
  .sans{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif}
  .mono{font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace}
  .spin,.spinr,.pop,.fade,.grow,.draw,.blink,.rise{transform-box:fill-box;transform-origin:center}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes spinr{to{transform:rotate(-360deg)}}
  @keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes blink{0%,100%{opacity:.25}50%{opacity:1}}
  @keyframes ping{0%{transform:scale(1);opacity:.9}100%{transform:scale(3.4);opacity:0}}
  @keyframes dash{to{stroke-dashoffset:-32}}
  @media (prefers-reduced-motion:reduce){*{animation:none!important}}
`

const svg = (w, h, label, css, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">
<style>${BASE_CSS}${css}</style>
<defs>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#fff" stroke-opacity=".035"/></pattern>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
  ${defs}
</defs>
${body}
</svg>
`

const write = (name, content) => {
  writeFileSync(join(OUT, name), content)
  console.log(`wrote ${name} (${content.length} bytes)`)
}

const range = (n) => Array.from({ length: n }, (_, i) => i)

/* ------------------------------------------------------------------ hero */

function hero() {
  const W = 1200
  const H = 600
  const trunkY = 430
  const forkX = 640
  const stream = range(11)
    .map((i) => {
      const x = -70 + i * 70
      return `<g transform="translate(${x} ${trunkY - 22})">
        <rect width="44" height="44" rx="9" fill="${C.block}" stroke="#fff" stroke-opacity=".2"/>
        <rect x="10" y="13" width="24" height="3" rx="1.5" fill="#fff" fill-opacity=".28"/>
        <rect x="10" y="21" width="16" height="3" rx="1.5" fill="#fff" fill-opacity=".16"/>
        <rect x="10" y="29" width="20" height="3" rx="1.5" fill="#fff" fill-opacity=".16"/>
      </g>`
    })
    .join('')

  const pathA = `M${forkX} ${trunkY} C 700 ${trunkY}, 720 360, 790 360 L 1150 360`
  const pathB = `M${forkX} ${trunkY} C 700 ${trunkY}, 720 500, 790 500 L 1150 500`

  const branchBlocks = (y, color, fill, changed) =>
    range(4)
      .map((i) => {
        const x = 830 + i * 80
        const hot = changed === i
        const stroke = hot ? C.yellow : color
        return `<g class="grow" style="animation-delay:${(i * 0.35).toFixed(2)}s">
          <rect x="${x}" y="${y - 22}" width="44" height="44" rx="9" fill="${hot ? 'rgba(255,213,74,.12)' : fill}" stroke="${stroke}" stroke-opacity="${hot ? 1 : 0.75}"/>
          ${
            hot
              ? `<text x="${x + 22}" y="${y + 6}" text-anchor="middle" class="mono" font-size="16" font-weight="700" fill="${C.yellow}">Δ</text>`
              : `<rect x="${x + 10}" y="${y - 9}" width="24" height="3" rx="1.5" fill="${color}" fill-opacity=".55"/>
          <rect x="${x + 10}" y="${y - 1}" width="16" height="3" rx="1.5" fill="${color}" fill-opacity=".3"/>
          <rect x="${x + 10}" y="${y + 7}" width="20" height="3" rx="1.5" fill="${color}" fill-opacity=".3"/>`
          }
        </g>`
      })
      .join('')

  const pulses = (path, color) =>
    range(3)
      .map(
        (i) => `<circle r="3.5" fill="${color}">
      <animateMotion dur="2.4s" repeatCount="indefinite" begin="${(i * 0.8).toFixed(1)}s" path="${path}"/>
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.85;1" dur="2.4s" repeatCount="indefinite" begin="${(i * 0.8).toFixed(1)}s"/>
    </circle>`,
      )
      .join('')

  const css = `
    .stream{animation:flow 1.4s linear infinite}
    @keyframes flow{to{transform:translateX(70px)}}
    .grow{opacity:0;animation:grow 5.6s var(--e,cubic-bezier(.2,.7,.1,1)) infinite}
    @keyframes grow{0%{opacity:0;transform:translateY(8px) scale(.85)}10%{opacity:1;transform:none}82%{opacity:1;transform:none}100%{opacity:0}}
    .ping{animation:ping 2s ease-out infinite}
    .flowA,.flowB{stroke-dasharray:2 14;animation:dash 1s linear infinite}
    .rise{opacity:0;animation:rise .9s cubic-bezier(.16,1,.3,1) forwards}
    .chip{opacity:0;animation:chip 5.6s ease infinite}
    @keyframes chip{0%,40%{opacity:0}52%,88%{opacity:1}100%{opacity:0}}
  `

  const defs = `
    <radialGradient id="g1" cx="${forkX}" cy="${trunkY}" r="460" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.lime}" stop-opacity=".17"/><stop offset="1" stop-color="${C.lime}" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="1080" cy="60" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.purple}" stop-opacity=".16"/><stop offset="1" stop-color="${C.purple}" stop-opacity="0"/></radialGradient>
    <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".3" stop-color="#fff"/></linearGradient>
    <mask id="fade"><rect width="${forkX - 12}" height="${H}" fill="url(#fadeL)"/></mask>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="24"/></clipPath>
  `

  const body = `
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="${C.bg}"/>
    <rect width="${W}" height="${H}" fill="url(#grid)"/>
    <rect width="${W}" height="${H}" fill="url(#g1)"/>
    <rect width="${W}" height="${H}" fill="url(#g2)"/>

    <g class="rise" style="animation-delay:.05s">
      <rect x="72" y="62" width="3" height="18" fill="${C.lime}"/>
      <text x="84" y="76" class="mono" font-size="16" fill="${C.text}">quantum fork<tspan fill="${C.lime}">⟩</tspan></text>
      <text x="${W - 72}" y="76" text-anchor="end" class="mono" font-size="13" letter-spacing="2" fill="${C.muted}">BLOCKCHAIN LABORATORY · BASE</text>
    </g>
    <text x="68" y="172" class="sans rise" font-size="96" font-weight="800" letter-spacing="-4" fill="${C.text}" style="animation-delay:.15s">FORK REALITY.</text>
    <text x="72" y="228" class="sans rise" font-size="38" font-weight="700" letter-spacing="-1" fill="${C.lime}" style="animation-delay:.3s">BUILD THE NEXT BLOCKCHAIN.</text>
    <g class="rise" style="animation-delay:.45s">
      <text x="72" y="276" class="sans" font-size="19" fill="${C.muted}">Fork live EVM state. Rewrite execution. Experiment with cryptography.</text>
      <text x="72" y="302" class="sans" font-size="19" fill="${C.muted}">Deploy programmable blockchain environments.</text>
    </g>

    <text x="72" y="${trunkY - 40}" class="mono" font-size="12" letter-spacing="1.5" fill="${C.faint}">BASE · LIVE STATE · BLOCK 49,851,225</text>
    <g mask="url(#fade)">
      <line x1="0" y1="${trunkY}" x2="${forkX}" y2="${trunkY}" stroke="#fff" stroke-opacity=".2"/>
      <g class="stream">${stream}</g>
    </g>

    <path d="${pathA}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.5"/>
    <path d="${pathB}" fill="none" stroke="${C.lime}" stroke-opacity=".35" stroke-width="1.5"/>
    <path class="flowA" d="${pathA}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/>
    <path class="flowB" d="${pathB}" fill="none" stroke="${C.lime}" stroke-width="1.5"/>
    ${pulses(pathA, '#fff')}
    ${pulses(pathB, C.lime)}

    ${branchBlocks(360, '#ffffff', 'rgba(255,255,255,.035)', -1)}
    ${branchBlocks(500, C.lime, 'rgba(200,255,77,.06)', 1)}

    <circle cx="${forkX}" cy="${trunkY}" r="26" fill="${C.lime}" opacity=".35" filter="url(#soft)"/>
    <circle class="ping" cx="${forkX}" cy="${trunkY}" r="10" fill="none" stroke="${C.lime}" style="transform-box:fill-box;transform-origin:center"/>
    <circle cx="${forkX}" cy="${trunkY}" r="9" fill="${C.lime}"/>
    <circle cx="${forkX}" cy="${trunkY}" r="3.5" fill="${C.bg}"/>

    <text x="830" y="322" class="mono" font-size="12" letter-spacing="1.5" fill="${C.muted}">REALITY A · ORIGINAL</text>
    <text x="830" y="552" class="mono" font-size="12" letter-spacing="1.5" fill="${C.lime}">REALITY B · REWRITTEN</text>
    <g class="chip">
      <text x="1150" y="408" text-anchor="end" class="mono" font-size="12" fill="${C.green}">A · success · 27,766 gas</text>
      <text x="1150" y="460" text-anchor="end" class="mono" font-size="12" fill="${C.yellow}">B · reverted · 21,160 gas</text>
      <text x="1150" y="434" text-anchor="end" class="mono" font-size="11" letter-spacing="1.5" fill="${C.faint}">SAME TX · DIFFERENT REALITY</text>
    </g>
  </g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="24" fill="none" stroke="#fff" stroke-opacity=".08"/>
  `
  write('hero.svg', svg(W, H, 'Quantum Fork. Fork reality. Build the next blockchain.', css, body, defs))
}

/* --------------------------------------------------------------- concept */

function concept() {
  const W = 1200
  const H = 720
  const cx = 600
  const cy = 360
  const r = 236
  const period = 9.6
  const steps = [
    ['DESIGN', 'Genesis Studio', "write the chain's DNA"],
    ['FORK', 'Reality Fork', 'clone live Base state'],
    ['REWIND', 'Time Machine', 'replay any transaction'],
    ['MUTATE', 'Mutation Engine', 'branch and version'],
    ['RACE', 'Fork Wars', 'benchmark two realities'],
    ['SPAWN', 'Ghost Chains', 'ephemeral networks'],
    ['HARDEN', 'Quantum Shield', 'post-quantum signatures'],
    ['PUBLISH', 'Explorer', 'hash it, share it'],
  ]
  const slot = period / steps.length
  const colors = [C.lime, C.green, C.cyan, C.purple, C.orange, C.yellow, C.purple, C.lime]

  const nodes = steps
    .map(([verb, name, desc], i) => {
      const a = ((-90 + i * 45) * Math.PI) / 180
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      const col = colors[i]
      const delay = `animation-delay:${(i * slot).toFixed(2)}s`
      let tx = x
      let ty = y
      let anchor = 'middle'
      if (i === 0) ty = y - 70
      else if (i === 4) ty = y + 46
      else if (i < 4) {
        tx = x + 30
        anchor = 'start'
        ty = y - 14
      } else {
        tx = x - 30
        anchor = 'end'
        ty = y - 14
      }
      return `<g>
        <circle class="halo" cx="${x}" cy="${y}" r="22" fill="${col}" filter="url(#soft)" style="${delay}"/>
        <circle cx="${x}" cy="${y}" r="9" fill="${C.bg}" stroke="${col}" stroke-width="2"/>
        <circle class="core" cx="${x}" cy="${y}" r="5" fill="${col}" style="${delay}"/>
        <g class="label" style="${delay}">
          <text x="${tx}" y="${ty}" text-anchor="${anchor}" class="mono" font-size="12" font-weight="700" letter-spacing="2.5" fill="${col}">0${i + 1} · ${verb}</text>
          <text x="${tx}" y="${ty + 26}" text-anchor="${anchor}" class="sans" font-size="22" font-weight="650" fill="${C.text}">${name}</text>
          <text x="${tx}" y="${ty + 46}" text-anchor="${anchor}" class="mono" font-size="12.5" fill="${C.muted}">${desc}</text>
        </g>
      </g>`
    })
    .join('')

  const circ = 2 * Math.PI * r
  const comet = [
    [220, 0.12, 3],
    [120, 0.3, 3],
    [50, 0.9, 3],
  ]
    .map(
      ([len, op, w]) =>
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.lime}" stroke-opacity="${op}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="0 ${(circ - len).toFixed(1)} ${len} 0" transform="rotate(-90 ${cx} ${cy})"/>`,
    )
    .join('')

  const helix = range(14)
    .map((i) => {
      const y = cy - 80 + i * 8
      const d = (i * 0.16).toFixed(2)
      return `<g>
        <circle class="hx" cx="${cx}" cy="${y}" r="2.6" fill="${C.lime}" style="animation-delay:-${d}s"/>
        <circle class="hx2" cx="${cx}" cy="${y}" r="2.6" fill="${C.purple}" style="animation-delay:-${d}s"/>
      </g>`
    })
    .join('')

  const css = `
    .orbit{transform-origin:${cx}px ${cy}px;animation:spin ${period}s linear infinite}
    .halo{opacity:0;animation:hl ${period}s ease-out infinite}
    @keyframes hl{0%{opacity:.75}14%{opacity:.75}24%,100%{opacity:0}}
    .label{opacity:.38;animation:lb ${period}s ease-out infinite}
    @keyframes lb{0%,14%{opacity:1}26%,100%{opacity:.38}}
    .core{opacity:.35;animation:cr ${period}s ease-out infinite}
    @keyframes cr{0%,14%{opacity:1}24%,100%{opacity:.35}}
    .ring1{transform-origin:${cx}px ${cy}px;animation:spin 40s linear infinite}
    .ring2{transform-origin:${cx}px ${cy}px;animation:spinr 22s linear infinite}
    .hx{animation:hx 3.5s ease-in-out infinite}
    .hx2{animation:hx2 3.5s ease-in-out infinite}
    @keyframes hx{0%,100%{transform:translateX(-46px);opacity:1}50%{transform:translateX(46px);opacity:.35}}
    @keyframes hx2{0%,100%{transform:translateX(46px);opacity:.35}50%{transform:translateX(-46px);opacity:1}}
  `
  const defs = `
    <radialGradient id="cg" cx="${cx}" cy="${cy}" r="360" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.lime}" stop-opacity=".1"/><stop offset="1" stop-color="${C.lime}" stop-opacity="0"/></radialGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="24"/></clipPath>
  `
  const body = `
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="${C.bg}"/>
    <rect width="${W}" height="${H}" fill="url(#grid)"/>
    <rect width="${W}" height="${H}" fill="url(#cg)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-opacity=".1"/>
    <g class="ring1"><circle cx="${cx}" cy="${cy}" r="150" fill="none" stroke="#fff" stroke-opacity=".14" stroke-dasharray="2 7"/></g>
    <g class="ring2"><circle cx="${cx}" cy="${cy}" r="126" fill="none" stroke="${C.lime}" stroke-opacity=".35" stroke-width="2" stroke-dasharray="160 40 24 40 60 40"/></g>
    ${helix}
    <text x="${cx}" y="${cy + 62}" text-anchor="middle" class="sans" font-size="24" font-weight="800" letter-spacing="-.5" fill="${C.text}">CHAIN DNA</text>
    <text x="${cx}" y="${cy + 84}" text-anchor="middle" class="mono" font-size="11" letter-spacing="1" fill="${C.lime}">qfork/chain-dna/v1</text>
    <g class="orbit">${comet}<circle cx="${cx}" cy="${cy - r}" r="5" fill="#fff"/></g>
    ${nodes}
    <text x="40" y="${H - 34}" class="mono" font-size="12" letter-spacing="1.5" fill="${C.faint}">ONE DOCUMENT · qfork/chain-dna/v1 · EVERY REALITY</text>
    <text x="${W - 40}" y="${H - 34}" text-anchor="end" class="mono" font-size="12" letter-spacing="1.5" fill="${C.faint}">THE QUANTUM FORK LOOP</text>
  </g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="24" fill="none" stroke="#fff" stroke-opacity=".08"/>
  `
  write('loop.svg', svg(W, H, 'The Quantum Fork loop: design, fork, rewind, mutate, race, spawn, harden, publish.', css, body, defs))
}

/* ----------------------------------------------------------------- cards */

const CW = 580
const CH = 330

function card(file, n, eyebrow, title, lines, glyph, glyphCss = '', accent = C.lime) {
  const css = glyphCss
  const defs = `<clipPath id="frame"><rect width="${CW}" height="${CH}" rx="20"/></clipPath>
    <radialGradient id="cgl" cx="${CW / 2}" cy="90" r="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${accent}" stop-opacity=".1"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`
  const body = `
  <g clip-path="url(#frame)">
    <rect width="${CW}" height="${CH}" fill="${C.card}"/>
    <rect width="${CW}" height="178" fill="url(#grid)"/>
    <rect width="${CW}" height="178" fill="url(#cgl)"/>
    <line x1="0" y1="178.5" x2="${CW}" y2="178.5" stroke="#fff" stroke-opacity=".07"/>
    <g>${glyph}</g>
    <text x="30" y="214" class="mono" font-size="12.5" font-weight="700" letter-spacing="2.5" fill="${accent}">${n} · ${eyebrow}</text>
    <text x="30" y="252" class="sans" font-size="30" font-weight="750" letter-spacing="-.8" fill="${C.text}">${title}</text>
    ${lines.map((l, i) => `<text x="30" y="${284 + i * 24}" class="sans" font-size="17" fill="${C.muted}">${l}</text>`).join('')}
  </g>
  <rect x=".5" y=".5" width="${CW - 1}" height="${CH - 1}" rx="20" fill="none" stroke="#fff" stroke-opacity=".09"/>
  `
  write(file, svg(CW, CH, `${eyebrow}: ${title}`, css, body, defs))
}

function cardGenesis() {
  const cx = 290
  const cy = 90
  const rings = [
    [20, C.green, '30 10 8 10', 9, false],
    [32, C.lime, '60 12 18 12', 14, true],
    [44, C.green, '14 8 40 8 6 8', 11, false],
    [56, C.lime, '90 18 24 18', 19, true],
    [68, C.green, '36 10 10 10 70 12', 16, false],
  ]
    .map(
      ([r, col, dash, dur, rev]) =>
        `<g class="${rev ? 'spinr' : 'spin'}" style="animation-duration:${dur}s;transform-origin:${cx}px ${cy}px;transform-box:view-box"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-dasharray="${dash}" stroke-linecap="round" opacity=".9"/></g>`,
    )
    .join('')
  const core = range(9)
    .map((i) => {
      const x = cx - 8 + (i % 3) * 6
      const y = cy - 8 + Math.floor(i / 3) * 6
      return `<rect class="blink" x="${x - 2}" y="${y - 2}" width="4" height="4" fill="${C.lime}" style="animation-delay:${(i * 0.23).toFixed(2)}s"/>`
    })
    .join('')
  const legend = [
    ['BUILT IN', C.green],
    ['YOUR CONTRACTS', C.cyan],
    ['NEEDS INFRA', C.yellow],
    ['RESEARCH', C.purple],
  ]
    .map(
      ([t, col], i) =>
        `<circle cx="36" cy="${50 + i * 24}" r="4" fill="${col}"/><text x="48" y="${54 + i * 24}" class="mono" font-size="11" letter-spacing="1" fill="${C.muted}">${t}</text>`,
    )
    .join('')
  const meta = `
    <text x="550" y="54" text-anchor="end" class="mono" font-size="11" letter-spacing="1" fill="${C.faint}">TARGET</text>
    <text x="550" y="72" text-anchor="end" class="mono" font-size="12" fill="${C.text}">base · anvil · op-stack</text>
    <text x="550" y="108" text-anchor="end" class="mono" font-size="11" letter-spacing="1" fill="${C.faint}">DOCUMENT HASH</text>
    <text x="550" y="126" text-anchor="end" class="mono" font-size="12" fill="${C.lime}">0xc3848ff6…4f4c4959</text>`
  card(
    'card-genesis.svg',
    '01',
    'GENESIS STUDIO',
    'Design the chain.',
    ['One Chain DNA document, three targets:', 'contracts on Base, local Anvil, an OP Stack rollup.'],
    rings + core + legend + meta,
    `.blink{animation:blink 1.8s ease-in-out infinite}`,
  )
}

function cardRealityFork() {
  const a = 'M240 90 C 290 90, 300 46, 350 46 L 545 46'
  const b = 'M240 90 C 290 90, 300 134, 350 134 L 545 134'
  const trunk = range(5)
    .map(
      (i) =>
        `<rect x="${-40 + i * 48}" y="74" width="32" height="32" rx="7" fill="${C.block}" stroke="#fff" stroke-opacity=".22"/>`,
    )
    .join('')
  const pulse = (p, col) =>
    range(2)
      .map(
        (i) =>
          `<circle r="3" fill="${col}"><animateMotion dur="2s" repeatCount="indefinite" begin="${i}s" path="${p}"/></circle>`,
      )
      .join('')
  const glyph = `
    <defs><linearGradient id="fl" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff"/></linearGradient><mask id="fm"><rect width="232" height="178" fill="url(#fl)"/></mask></defs>
    <g mask="url(#fm)"><line x1="0" y1="90" x2="240" y2="90" stroke="#fff" stroke-opacity=".2"/><g class="tr">${trunk}</g></g>
    <path d="${a}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>
    <path d="${b}" fill="none" stroke="${C.lime}" stroke-opacity=".8" stroke-width="1.5"/>
    ${pulse(a, '#fff')}${pulse(b, C.lime)}
    <circle cx="240" cy="90" r="16" fill="${C.lime}" opacity=".4" filter="url(#soft)"/>
    <circle cx="240" cy="90" r="7" fill="${C.lime}"/>
    <text x="545" y="32" text-anchor="end" class="mono" font-size="11.5" fill="${C.green}">original · success · 27,766 gas</text>
    <text x="545" y="160" text-anchor="end" class="mono" font-size="11.5" fill="${C.yellow}">modified · reverted · 21,160 gas</text>
    <text x="30" y="40" class="mono" font-size="11" letter-spacing="1" fill="${C.faint}">BLOCK 49,851,225</text>`
  card(
    'card-reality-fork.svg',
    '02',
    'REALITY FORK',
    'Fork live Base state.',
    ['Two forks of the same block. Change code,', 'storage or balances. Diff every call tree.'],
    glyph,
    `.tr{animation:tr 1.2s linear infinite}@keyframes tr{to{transform:translateX(48px)}}`,
  )
}

function cardTimeMachine() {
  const n = 8
  const cycle = 6
  const cells = range(n)
    .map((i) => {
      const x = 46 + i * 62
      const target = i === n - 1
      const deposit = i < 2
      const col = target ? C.lime : deposit ? C.cyan : '#ffffff'
      const delay = ((i / n) * 3).toFixed(2)
      return `<g>
        <rect x="${x}" y="66" width="44" height="44" rx="9" fill="${C.block}" stroke="${col}" stroke-opacity="${target ? 0.9 : 0.3}"/>
        <rect class="fillc" x="${x}" y="66" width="44" height="44" rx="9" fill="${col}" style="animation-delay:${delay}s"/>
        <text x="${x + 22}" y="128" text-anchor="middle" class="mono" font-size="10.5" fill="${target ? C.lime : C.muted}">${target ? 'target' : deposit ? '0x7e' : `tx ${i}`}</text>
      </g>`
    })
    .join('')
  const glyph = `
    <text x="30" y="40" class="mono" font-size="11" letter-spacing="1" fill="${C.faint}">FORK PARENT → REPLAY PREFIX → MINE</text>
    ${cells}
    <rect class="scan" x="40" y="58" width="2" height="60" fill="${C.lime}"/>
    <g class="ok"><text x="550" y="40" text-anchor="end" class="mono" font-size="11.5" fill="${C.green}">✓ status · gas · logs · block match</text></g>
    <text x="30" y="160" class="mono" font-size="11" fill="${C.muted}">pinned: Base Sepolia block 49,873,286 · 113,939 gas · 2 events</text>`
  card(
    'card-time-machine.svg',
    '03',
    'TIME MACHINE',
    'Rewind any transaction.',
    ['Fork its parent block, replay everything', 'ahead of it, match the real receipt. Then edit.'],
    glyph,
    `.fillc{opacity:0;animation:fc ${cycle}s ease-out infinite}
     @keyframes fc{0%{opacity:0}6%{opacity:.18}80%{opacity:.18}90%,100%{opacity:0}}
     .scan{animation:sc ${cycle}s linear infinite}
     @keyframes sc{0%{transform:translateX(0);opacity:1}50%{transform:translateX(${(n - 1) * 62 + 50}px);opacity:1}55%,100%{transform:translateX(${(n - 1) * 62 + 50}px);opacity:0}}
     .ok{opacity:0;animation:ok ${cycle}s ease infinite}
     @keyframes ok{0%,52%{opacity:0}58%,86%{opacity:1}94%,100%{opacity:0}}`,
  )
}

function cardForkWars() {
  const cycle = 6
  const lane = (y, label, color, stat, cls, dots) => `
    <text x="30" y="${y + 5}" class="mono" font-size="11.5" letter-spacing="1" fill="${C.text}">${label}</text>
    <rect x="150" y="${y - 6}" width="250" height="12" rx="6" fill="#fff" fill-opacity=".06"/>
    <rect class="${cls}" x="150" y="${y - 6}" width="250" height="12" rx="6" fill="${color}"/>
    ${dots}
    <text x="550" y="${y + 5}" text-anchor="end" class="mono" font-size="11.5" fill="${color}">${stat}</text>`
  const dots = (y, cls, color) =>
    range(4)
      .map(
        (i) =>
          `<circle class="${cls}" cx="${150 + 62 * (i + 1) - 6}" cy="${y + 20}" r="3" fill="${color}" style="animation-delay:${cls === 'da' ? (i * 0.08).toFixed(2) : (i * 1).toFixed(2)}s"/>`,
      )
      .join('')
  const glyph = `
    <text x="30" y="36" class="mono" font-size="11" letter-spacing="1" fill="${C.faint}">ERC-20 TRANSFER × 4 · SAME BYTECODE · TWO ANVILS</text>
    ${lane(72, 'AUTOMINE', C.lime, '66.67 tx/s · 15 ms', 'ba', dots(72, 'da', C.lime))}
    ${lane(128, 'INTERVAL 1s', C.purple, '1.02 tx/s · 977 ms', 'bb', dots(128, 'db', C.purple))}
    <text x="30" y="166" class="mono" font-size="10.5" fill="${C.muted}">gas identical: 305,746 both sides · peak RSS 16.0 MB vs 21.8 MB</text>`
  card(
    'card-fork-wars.svg',
    '04',
    'FORK WARS',
    'Race two realities.',
    ['Same workload, two chain configurations.', 'Gas, latency, throughput, memory. Measured.'],
    glyph,
    `.ba,.bb{transform-box:fill-box;transform-origin:left center;transform:scaleX(0)}
     .ba{animation:ba ${cycle}s cubic-bezier(.2,.7,.1,1) infinite}
     .bb{animation:bb ${cycle}s linear infinite}
     @keyframes ba{0%{transform:scaleX(0)}5%{transform:scaleX(1)}90%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}
     @keyframes bb{0%{transform:scaleX(0)}70%{transform:scaleX(1)}90%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}
     .da,.db{opacity:0}
     .da{animation:dt ${cycle}s ease infinite}
     .db{animation:dt ${cycle}s ease infinite}
     @keyframes dt{0%{opacity:0}2%{opacity:1}90%{opacity:1}100%{opacity:0}}`,
    C.lime,
  )
}

function cardGhostChains() {
  const cycle = 7.5
  const rows = [
    ['15m', 46, 0],
    ['1h', 92, 1.2],
    ['24h', 138, 2.4],
  ]
  const glyph = rows
    .map(([ttl, y, off]) => {
      const blocks = range(6)
        .map(
          (i) =>
            `<rect class="gb" x="${90 + i * 46}" y="${y - 14}" width="32" height="28" rx="7" fill="rgba(157,123,255,.08)" stroke="${C.purple}" stroke-opacity=".8" style="animation-delay:${(off + i * 0.18).toFixed(2)}s"/>`,
        )
        .join('')
      const st = (t, col, cls) =>
        `<text class="${cls} mono" x="550" y="${y + 4}" text-anchor="end" font-size="11" letter-spacing="1" fill="${col}" style="animation-delay:${off}s">${t}</text>`
      return `<g>
        <text x="30" y="${y + 4}" class="mono" font-size="12" fill="${C.text}">${ttl}</text>
        <line x1="90" y1="${y}" x2="${90 + 5 * 46 + 32}" y2="${y}" stroke="${C.purple}" stroke-opacity=".2" stroke-dasharray="3 5"/>
        ${blocks}
        ${st('RUNNING', C.green, 's1')}${st('EXPIRING', C.yellow, 's2')}${st('TERMINATED', C.faint, 's3')}
      </g>`
    })
    .join('')
  card(
    'card-ghost-chains.svg',
    '05',
    'GHOST CHAINS',
    'Spawn ephemeral chains.',
    ['Throwaway networks that live 15 minutes', 'to 24 hours, then vanish with a snapshot.'],
    glyph,
    `.gb{opacity:0;animation:gb ${cycle}s ease infinite}
     @keyframes gb{0%{opacity:0;transform:scale(.6)}6%{opacity:1;transform:none}55%{opacity:1}75%{opacity:.25}88%,100%{opacity:0}}
     .gb{transform-box:fill-box;transform-origin:center}
     .s1,.s2,.s3{opacity:0}
     .s1{animation:s1 ${cycle}s ease infinite}.s2{animation:s2 ${cycle}s ease infinite}.s3{animation:s3 ${cycle}s ease infinite}
     @keyframes s1{0%,8%{opacity:0}12%,54%{opacity:1}58%,100%{opacity:0}}
     @keyframes s2{0%,56%{opacity:0}60%,74%{opacity:1}78%,100%{opacity:0}}
     @keyframes s3{0%,76%{opacity:0}80%,96%{opacity:1}100%{opacity:0}}`,
    C.purple,
  )
}

function cardMutation() {
  const cycle = 7
  const N = {
    v1: [60, 92],
    v2: [170, 92],
    v3: [290, 52],
    v4: [420, 52],
    b3: [290, 132],
    b4: [420, 132],
  }
  const edges = [
    ['v1', 'v2', 0],
    ['v2', 'v3', 0.6],
    ['v3', 'v4', 1.2],
    ['v2', 'b3', 1.8],
    ['b3', 'b4', 2.4],
  ]
    .map(([f, t, d]) => {
      const [x1, y1] = N[f]
      const [x2, y2] = N[t]
      const p = y1 === y2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`
      return `<path class="ed" d="${p}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5" pathLength="100" style="animation-delay:${d}s"/>`
    })
    .join('')
  const nodes = [
    ['v1', 'v1 · seed', C.text, 0, 'BASE'],
    ['v2', 'v2', C.cyan, 0.5, 'CONTRACT'],
    ['v3', 'v3', C.lime, 1.1, 'LOCAL ANVIL'],
    ['v4', 'v4', C.yellow, 1.7, 'DEDICATED CHAIN'],
    ['b3', 'v3′', C.purple, 2.3, 'BRANCH'],
    ['b4', 'v4′', C.red, 2.9, 'IMPOSSIBLE ON BASE'],
  ]
    .map(([k, label, col, d, chip]) => {
      const [x, y] = N[k]
      return `<g class="nd" style="animation-delay:${d}s">
        <circle cx="${x}" cy="${y}" r="9" fill="${C.bg}" stroke="${col}" stroke-width="2"/>
        <circle cx="${x}" cy="${y}" r="3.5" fill="${col}"/>
        <text x="${x}" y="${y - 16}" text-anchor="middle" class="mono" font-size="11" fill="${C.text}">${label}</text>
        <text x="${x + (k === 'v4' || k === 'b4' ? 16 : 0)}" y="${y + 24}" text-anchor="${k === 'v4' || k === 'b4' ? 'start' : 'middle'}" class="mono" font-size="9.5" letter-spacing="1" fill="${col}">${chip}</text>
      </g>`
    })
    .join('')
  card(
    'card-mutation.svg',
    '06',
    'MUTATION ENGINE',
    'Evolve the genome.',
    ['Version, branch and roll back a chain design.', 'Every change classified by what it touches.'],
    edges + nodes,
    `.ed{stroke-dasharray:100;stroke-dashoffset:100;animation:ed ${cycle}s ease infinite}
     @keyframes ed{0%{stroke-dashoffset:100;opacity:1}8%{stroke-dashoffset:0}85%{stroke-dashoffset:0;opacity:1}95%,100%{opacity:0;stroke-dashoffset:0}}
     .nd{opacity:0;animation:nd ${cycle}s cubic-bezier(.2,.7,.1,1) infinite}
     @keyframes nd{0%{opacity:0;transform:translateY(6px)}6%{opacity:1;transform:none}85%{opacity:1}95%,100%{opacity:0}}`,
    C.cyan,
  )
}

function cardQuantumShield() {
  const cycle = 7
  const max = 17088
  const bars = [
    ['ECDSA secp256k1', 65, C.red],
    ['ML-DSA-44', 2420, C.purple],
    ['ML-DSA-87', 4627, C.purple],
    ['SLH-DSA-128s', 7856, C.cyan],
    ['SLH-DSA-128f', 17088, C.cyan],
  ]
    .map(([name, bytes, col], i) => {
      const y = 48 + i * 22
      const w = Math.max(3, (bytes / max) * 250)
      return `<text x="30" y="${y + 4}" class="mono" font-size="11.5" fill="${C.text}">${name}</text>
        <rect class="qb" x="160" y="${y - 6}" width="${w.toFixed(1)}" height="11" rx="3" fill="${col}" style="animation-delay:${(i * 0.25).toFixed(2)}s"/>
        <text x="550" y="${y + 4}" text-anchor="end" class="mono" font-size="11.5" fill="${col}">${bytes.toLocaleString('en-US')} B</text>`
    })
    .join('')
  const glyph = `<text x="30" y="28" class="mono" font-size="11" letter-spacing="1" fill="${C.faint}">SIGNATURE SIZE · FIPS 204 / FIPS 205 · MEASURED IN-BROWSER</text>${bars}
    <text x="30" y="166" class="mono" font-size="10.5" fill="${C.muted}">ML-DSA-44 signature = 37× ECDSA · 38,240 gas of calldata to carry it</text>`
  card(
    'card-quantum-shield.svg',
    '07',
    'QUANTUM SHIELD',
    'Post-quantum, measured.',
    ['ML-DSA and SLH-DSA next to ECDSA, live on your', 'device: key sizes, speed, and the gas to carry them.'],
    glyph,
    `.qb{transform-box:fill-box;transform-origin:left center;transform:scaleX(0);animation:qb ${cycle}s cubic-bezier(.16,1,.3,1) infinite}
     @keyframes qb{0%{transform:scaleX(0)}14%{transform:scaleX(1)}88%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}`,
    C.purple,
  )
}

function cardExplorer() {
  const palette = [C.green, C.cyan, C.yellow, C.purple, C.lime]
  let seed = 7
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  const bars = range(64)
    .map((i) => {
      const col = palette[Math.floor(rand() * palette.length)]
      const h = 30 + Math.floor(rand() * 60)
      return `<rect class="gn" x="${30 + i * 8}" y="${100 - h / 2}" width="5" height="${h}" rx="2" fill="${col}" style="animation-delay:${(i * 0.045).toFixed(3)}s"/>`
    })
    .join('')
  const glyph = `<text x="30" y="34" class="mono" font-size="11" letter-spacing="1" fill="${C.faint}">GENOME · qfork/chain-dna/v1</text>
    ${bars}
    <text x="30" y="164" class="mono" font-size="12" fill="${C.lime}">quantumfork.wtf/explore/0xc3848ff6…4f4c4959</text>
    <text x="550" y="34" text-anchor="end" class="mono" font-size="11" letter-spacing="1" fill="${C.green}">✓ VALIDATED · WRITE-ONCE</text>`
  card(
    'card-explorer.svg',
    '08',
    'EXPLORER',
    'Publish the DNA.',
    ['Every configuration is normalised, validated,', 'hashed and stored write-once at its own URL.'],
    glyph,
    `.gn{transform-box:fill-box;transform-origin:center;animation:gn 2.8s ease-in-out infinite}
     @keyframes gn{0%,100%{transform:scaleY(.35);opacity:.45}50%{transform:scaleY(1);opacity:1}}`,
    C.green,
  )
}

/* -------------------------------------------------------------- divider */

function divider() {
  const W = 1200
  const H = 24
  const body = `
    <line x1="0" y1="12" x2="${W}" y2="12" stroke="#fff" stroke-opacity=".08"/>
    <rect class="sweep" x="0" y="11" width="220" height="2" fill="url(#sw)"/>`
  const defs = `<linearGradient id="sw" x1="0" x2="1"><stop offset="0" stop-color="${C.lime}" stop-opacity="0"/><stop offset=".5" stop-color="${C.lime}"/><stop offset="1" stop-color="${C.lime}" stop-opacity="0"/></linearGradient>`
  const css = `.sweep{animation:sw 3.6s cubic-bezier(.6,0,.4,1) infinite}@keyframes sw{from{transform:translateX(-240px)}to{transform:translateX(${W + 20}px)}}`
  write('divider.svg', svg(W, H, '', css, body, defs))
}

hero()
concept()
cardGenesis()
cardRealityFork()
cardTimeMachine()
cardForkWars()
cardGhostChains()
cardMutation()
cardQuantumShield()
cardExplorer()
divider()
