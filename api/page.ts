import { route } from './_lib/http.js'
import { blueprintCard, burnCard, type Card, pageCard, speciesCard } from './_lib/specimen.js'

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inject(html: string, meta: { title: string; description: string; url: string; image: string }) {
  const title = escape(meta.title)
  const description = escape(meta.description)
  const url = escape(meta.url)
  const image = escape(meta.image)
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${description}"`)
    .replace(/(<link rel="canonical" href=")[^"]*"/, `$1${url}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${title}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${description}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${url}"`)
    .replace(/(<meta property="og:image" content=")[^"]*"/, `$1${image}"`)
    .replace(/(<meta name="twitter:title" content=")[^"]*"/, `$1${title}"`)
    .replace(/(<meta name="twitter:description" content=")[^"]*"/, `$1${description}"`)
    .replace(/(<meta name="twitter:image" content=")[^"]*"/, `$1${image}"`)
}

/**
 * Serves the SPA shell for /species/:id, /burn/:id, /blueprints, /blueprints/:slug and /build with route-specific
 * metadata, so link previews show the descendant or receipt.
 */
export const { GET, POST } = route('page', {
  async GET(context) {
    const kind = context.url.searchParams.get('kind')
    const id = context.url.searchParams.get('id') ?? ''
    const site = context.env.config.siteUrl.replace(/\/$/, '') || context.url.origin
    const shell = await fetch(`${context.url.origin}/index.html`, { signal: AbortSignal.timeout(4000) }).then((response) => (response.ok ? response.text() : null))
    if (!shell) return new Response('Not found', { status: 404 })

    let card: Card | null = null
    let path = ''
    let image = ''
    try {
      if (kind === 'species' && /^[a-z0-9_-]{1,64}$/.test(id)) {
        card = await speciesCard(context.store, id)
        path = `/species/${id}`
        image = `species=${encodeURIComponent(id)}`
      } else if (kind === 'burn' && /^[A-Za-z0-9-]{8,100}$/.test(id)) {
        card = await burnCard(context.store, id)
        path = `/burn/${id}`
        image = `burn=${encodeURIComponent(id)}`
      } else if (kind === 'blueprint' && /^[a-z0-9-]{1,48}$/.test(id)) {
        card = blueprintCard(id)
        path = `/blueprints/${id}`
        image = `blueprint=${id}`
      } else if (kind === 'blueprints' || kind === 'build') {
        card = pageCard(kind)
        path = `/${kind}`
        image = `page=${kind}`
      }
    } catch {
      card = null
    }

    const html = card
      ? inject(shell, {
          title: `${card.pageTitle ?? card.title} · Quantum Fork`,
          description: card.description,
          url: `${site}${path}`,
          image: `${site}/api/og?${image}`,
        })
      : shell
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    })
  },
})
