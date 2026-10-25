import { ImageResponse } from '@vercel/og'
import type { ReactElement } from 'react'
import { route } from './_lib/http.js'
import { isBase58Address } from '../src/protocol/address.js'
import { blueprintCard, burnCard, type Card, pageCard, speciesCard, tokenCard } from './_lib/specimen.js'

const TONES: Record<Card['tone'], string> = {
  lime: '#c8ff4d',
  orange: '#ff7a3c',
  cyan: '#4fe3ff',
  green: '#3dffa0',
  yellow: '#ffd54a',
  purple: '#9d7bff',
  red: '#ff4d5e',
  steel: '#eceae4',
  muted: '#8d8c88',
}

type Node = { type: string; props: { style?: Record<string, unknown>; children?: Node | string | (Node | string)[] } }
const el = (type: string, style: Record<string, unknown>, children?: Node['props']['children']): Node => ({ type, props: { style, children } })

const FALLBACK: Card = {
  kicker: 'QUANTUM FORK · POST-QUANTUM BLOCKCHAIN LAB',
  title: 'Build for the quantum future.',
  subtitle: 'NO CODE REQUIRED.',
  lines: ['Launch blockchains, secure digital assets and build applications with post-quantum cryptography.'],
  tone: 'lime',
  description: '',
}

function render(card: Card, host: string) {
  const tone = TONES[card.tone]
  const tree = el(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px 72px',
      background: `radial-gradient(60% 70% at 85% 30%, ${tone}22, transparent 70%), #060708`,
      color: '#eceae4',
      fontFamily: 'Geist',
    },
    [
      el('div', { display: 'flex', alignItems: 'center', gap: 14, fontSize: 22, letterSpacing: 4, color: '#8d8c88' }, [
        el('div', { width: 14, height: 14, borderRadius: 7, background: tone, boxShadow: `0 0 24px ${tone}` }),
        'QUANTUM FORK',
      ]),
      el('div', { display: 'flex', flexDirection: 'column', gap: 18 }, [
        el('div', { fontSize: 24, letterSpacing: 5, color: tone }, card.kicker),
        el('div', { fontSize: card.title.length > 22 ? 76 : 104, letterSpacing: -3, lineHeight: 1 }, card.title),
        el('div', { fontSize: 26, letterSpacing: 3, color: '#8d8c88' }, card.subtitle),
      ]),
      el(
        'div',
        { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 48, fontSize: 20, letterSpacing: 2, color: '#5a5b5c' },
        [
          el('div', { display: 'flex', flexDirection: 'column', gap: 6, flex: 1, maxWidth: 760 }, card.lines.slice(0, 2).map((line) => el('div', { display: 'flex' }, line))),
          el('div', { display: 'flex', flexShrink: 0 }, host.toUpperCase()),
        ],
      ),
    ],
  )
  return new ImageResponse(tree as unknown as ReactElement, {
    width: 1200,
    height: 630,
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' },
  })
}

/** 512×512 token image: the ψ mark above the symbol. */
function renderToken(token: { symbol: string; name: string; descendant: string }) {
  const tree = el(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 18,
      background: 'radial-gradient(70% 70% at 50% 40%, #c8ff4d26, transparent 70%), #060708',
      color: '#eceae4',
      fontFamily: 'Geist',
    },
    [
      el('div', { display: 'flex', fontSize: token.symbol.length > 6 ? 84 : 120, letterSpacing: -4, lineHeight: 1, color: '#c8ff4d' }, `$${token.symbol}`),
      el('div', { display: 'flex', fontSize: 30, letterSpacing: 1, maxWidth: 440, textAlign: 'center' }, token.name),
      el('div', { display: 'flex', fontSize: 18, letterSpacing: 4, color: '#8d8c88' }, token.descendant ? `${token.descendant} · QUANTUM FORK` : 'QUANTUM FORK'),
    ],
  )
  return new ImageResponse(tree as unknown as ReactElement, {
    width: 512,
    height: 512,
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' },
  })
}

export const { GET, POST } = route('og', {
  async GET(context) {
    const mint = context.url.searchParams.get('token')
    if (mint && (isBase58Address(mint) || /^clk_[0-9a-f]{32}$/.test(mint))) {
      const token = await tokenCard(context.store, mint).catch(() => null)
      if (token) return renderToken(token)
    }
    const species = context.url.searchParams.get('species')
    const burn = context.url.searchParams.get('burn')
    const blueprint = context.url.searchParams.get('blueprint')
    const page = context.url.searchParams.get('page')
    let card: Card | null = null
    try {
      if (species && /^[a-z0-9_-]{1,64}$/.test(species)) card = await speciesCard(context.store, species)
      else if (burn && /^[A-Za-z0-9-]{8,100}$/.test(burn)) card = await burnCard(context.store, burn)
      else if (blueprint && /^[a-z0-9-]{1,48}$/.test(blueprint)) card = blueprintCard(blueprint)
      else if (page === 'blueprints' || page === 'build') card = pageCard(page)
    } catch {
      card = null
    }
    let host = context.url.host
    try {
      host = new URL(context.env.config.siteUrl).host || host
    } catch {
      // An unset or malformed SITE_URL falls back to the request host.
    }
    return render(card ?? FALLBACK, host)
  },
})
