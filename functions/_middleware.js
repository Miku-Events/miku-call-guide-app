import {
  LEGACY_APP_ORIGINS,
  PRODUCTION_APP_ORIGIN,
} from './_lib/productionHostname.js'

const legacyHostnames = new Set(LEGACY_APP_ORIGINS.map((origin) => new URL(origin).hostname))

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url)
  if (!legacyHostnames.has(requestUrl.hostname)) {
    return context.next()
  }

  const destination = new URL(requestUrl.pathname + requestUrl.search, PRODUCTION_APP_ORIGIN)
  return new Response(null, {
    status: 308,
    headers: {
      'cache-control': 'no-store',
      location: destination.toString(),
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
    },
  })
}
