import {
  GOOGLE_TAG_GATEWAY_HEALTH_COLLECT_URL,
  GOOGLE_TAG_GATEWAY_HEALTH_SCRIPT_URL,
  GOOGLE_TAG_GATEWAY_INLINE_SCRIPT_HASHES,
  TURNSTILE_ORIGIN,
  X_ORIGINS,
  YOUTUBE_FRAME_ORIGINS,
  YOUTUBE_SCRIPT_ORIGINS,
} from './static-csp-sources.mjs'

function configuredOrigin(name, value, optional = false) {
  const rawValue = String(value ?? '')
  if (!rawValue) {
    if (optional) return ''
    throw new Error(`${name} is required to generate dist/_headers`)
  }
  if (/\r|\n/.test(rawValue)) {
    throw new Error(`${name} must be a single-line absolute URL`)
  }

  let url
  try {
    url = new URL(rawValue)
  } catch {
    throw new Error(`${name} must be a valid absolute URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`)
  }
  return url.origin
}

function joinDirective(name, values) {
  return `${name} ${[...new Set(values.filter(Boolean))].join(' ')}`
}

export function generateStaticHeaders(environment) {
  const appOrigin = configuredOrigin('VITE_APP_ORIGIN', environment.VITE_APP_ORIGIN)
  const dataOrigin = configuredOrigin(
    'VITE_DATA_MANIFEST_URL',
    environment.VITE_DATA_MANIFEST_URL,
  )
  const submissionOrigin = configuredOrigin(
    'VITE_SUBMISSION_API_URL',
    environment.VITE_SUBMISSION_API_URL,
    true,
  )

  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    joinDirective('connect-src', [
      "'self'",
      dataOrigin,
      submissionOrigin,
      GOOGLE_TAG_GATEWAY_HEALTH_COLLECT_URL,
      TURNSTILE_ORIGIN,
      ...YOUTUBE_FRAME_ORIGINS,
      ...X_ORIGINS,
    ]),
    joinDirective('script-src', [
      "'self'",
      ...GOOGLE_TAG_GATEWAY_INLINE_SCRIPT_HASHES,
      GOOGLE_TAG_GATEWAY_HEALTH_SCRIPT_URL,
      TURNSTILE_ORIGIN,
      ...YOUTUBE_SCRIPT_ORIGINS,
      ...X_ORIGINS,
    ]),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://pbs.twimg.com https://abs.twimg.com",
    joinDirective('frame-src', [
      TURNSTILE_ORIGIN,
      ...YOUTUBE_FRAME_ORIGINS,
      ...X_ORIGINS,
    ]),
    joinDirective('form-action', ["'self'", appOrigin]),
    "manifest-src 'self'",
  ].join('; ')
  return [
    '/*',
    `  Content-Security-Policy: ${contentSecurityPolicy}`,
    '  Strict-Transport-Security: max-age=31536000',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '',
    '/release.json',
    '  Cache-Control: no-store',
    '',
  ].join('\n')
}
