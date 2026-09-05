const CANONICAL_APP_ORIGIN = 'https://miku.sekai.today'
const CLOUDFLARE_BEACON_URL = 'https://static.cloudflareinsights.com/beacon.min.js'
const cloudflareWebAnalyticsTokenPattern = /^[a-f0-9]{32}$/

export interface CloudflareWebAnalyticsLoaderOptions {
  readonly document: Document
  readonly origin: string
  readonly productionRelease: boolean
  readonly token: unknown
}

function isValidCloudflareWebAnalyticsToken(token: unknown): token is string {
  return typeof token === 'string' && cloudflareWebAnalyticsTokenPattern.test(token)
}

export function initializeCloudflareWebAnalytics({
  document,
  origin,
  productionRelease,
  token,
}: CloudflareWebAnalyticsLoaderOptions): void {
  if (
    !productionRelease
    || origin !== CANONICAL_APP_ORIGIN
    || !isValidCloudflareWebAnalyticsToken(token)
    || document.querySelector(`script[src="${CLOUDFLARE_BEACON_URL}"]`) !== null
  ) {
    return
  }

  const script = document.createElement('script')
  script.type = 'module'
  script.src = CLOUDFLARE_BEACON_URL
  script.dataset.cfBeacon = JSON.stringify({ token })
  document.head.append(script)
}
