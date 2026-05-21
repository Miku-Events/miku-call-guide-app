import type { EventLink } from '../data/types'

export function isEmbeddableXPost(link: EventLink): boolean {
  if (link.platform !== 'x' || !link.embed) {
    return false
  }

  try {
    const url = new URL(link.url)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    return ['x.com', 'twitter.com', 'mobile.twitter.com'].includes(hostname) && /\/status(?:es)?\/\d+/.test(url.pathname)
  } catch {
    return false
  }
}
