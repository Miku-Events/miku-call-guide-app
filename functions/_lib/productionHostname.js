const reservedHostnameTlds = new Set(['localhost', 'example', 'invalid', 'test'])
const reservedExampleHostnames = ['example.com', 'example.net', 'example.org']

export const PRODUCTION_APP_ORIGIN = 'https://miku-call-guide-app.pages.dev'
export const LEGACY_APP_ORIGINS = Object.freeze(['https://miku.sekai.today'])

export function canonicalSecureHostname(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return ''
  }

  const hostname = value.toLowerCase()
  if (hostname.length > 253 || /^\d+(?:\.\d+){3}$/.test(hostname)) {
    return ''
  }

  const labels = hostname.split('.')
  if (labels.some((label) => (
    label.length === 0
    || label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) {
    return ''
  }

  if (
    reservedHostnameTlds.has(labels.at(-1))
    || reservedExampleHostnames.some((reservedHostname) => (
      hostname === reservedHostname || hostname.endsWith(`.${reservedHostname}`)
    ))
    || labels.some((label) => (
      label.startsWith('your-')
      || label.startsWith('replace-with-')
      || label.includes('placeholder')
    ))
  ) {
    return ''
  }

  return hostname
}

export function canonicalProductionOrigin(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return ''
  }

  let url
  try {
    url = new URL(value)
  } catch {
    return ''
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || canonicalSecureHostname(url.hostname) !== url.hostname
    || value !== url.origin
  ) {
    return ''
  }

  return url.origin
}
