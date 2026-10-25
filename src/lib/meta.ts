import { useEffect } from 'react'
import { CLIENT_CONFIG } from '../config'

export const SITE_TITLE = 'Quantum Fork — Post-Quantum Blockchain Lab'
export const SITE_DESCRIPTION = 'Launch blockchains, secure digital assets and build applications with post-quantum cryptography. No code required.'

function setMeta(selector: string, attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.content = content
}

/** Client-side head tags; species and burn pages also get server-rendered tags for crawlers. */
export function usePageMeta({ title, description = SITE_DESCRIPTION, path, image = '/og.jpg' }: { title?: string; description?: string; path: string; image?: string }) {
  useEffect(() => {
    const full = title ? `${title} · Quantum Fork` : SITE_TITLE
    const url = `${CLIENT_CONFIG.siteUrl}${path}`
    const imageUrl = image.startsWith('http') ? image : `${CLIENT_CONFIG.siteUrl}${image}`
    document.title = full
    setMeta('meta[name="description"]', 'name', 'description', description)
    setMeta('meta[property="og:title"]', 'property', 'og:title', full)
    setMeta('meta[property="og:description"]', 'property', 'og:description', description)
    setMeta('meta[property="og:url"]', 'property', 'og:url', url)
    setMeta('meta[property="og:image"]', 'property', 'og:image', imageUrl)
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', full)
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description)
    setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', imageUrl)
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = url
  }, [title, description, path, image])
}
