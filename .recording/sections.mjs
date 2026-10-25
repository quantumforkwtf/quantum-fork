// Height of each homepage section in screens, and where algorithm names appear in it.
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const NAMES = /\b(ML-KEM|ML-DSA|SLH-DSA|FN-DSA|Falcon|Ed25519|ED25519|secp256k1|SECP256K1|X25519|RSA|SHA-256|SHA-3|AES-256|BLS12-381|Blake3|Shor|Grover|Kyber|Dilithium|SPHINCS\+?|Groth16|PLONK)\b/gi
const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript(() => window.localStorage.setItem('qfork.tour.v1', 'skipped'))
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const rows = await page.$$eval(
    'main > section, main > div > section, main section.hero, main section.section, main section.final-word',
    (nodes, source) => {
      const pattern = new RegExp(source, 'gi')
      const seen = new Set()
      return nodes
        .filter((node) => !seen.has(node) && seen.add(node) && !node.parentElement?.closest('section'))
        .map((node) => ({
          head: (node.querySelector('h1, h2')?.textContent ?? node.getAttribute('aria-label') ?? '?').replace(/\s+/g, ' ').trim(),
          screens: +(node.getBoundingClientRect().height / window.innerHeight).toFixed(2),
          names: [...new Set((node.innerText.match(pattern) ?? []).map((name) => name.toUpperCase()))].join(' '),
        }))
    },
    NAMES.source,
  )
  console.log(`\n${viewport.width}px`)
  for (const row of rows) console.log(`${String(row.screens).padStart(5)}  ${row.head}${row.names ? `   [${row.names}]` : ''}`)
  console.log(`total ${rows.reduce((sum, row) => sum + row.screens, 0).toFixed(1)} screens`)
  await context.close()
}
await browser.close()
