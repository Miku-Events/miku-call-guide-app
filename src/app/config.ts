const devManifestUrl = 'http://localhost:4174/manifest.json'

export function getRootManifestUrl(): string {
  return import.meta.env.VITE_DATA_MANIFEST_URL ?? import.meta.env.VITE_CALL_GUIDE_MANIFEST_URL ?? (import.meta.env.DEV ? devManifestUrl : '')
}

export function getSubmissionApiBaseUrl(): string {
  return import.meta.env.VITE_SUBMISSION_API_URL || (typeof window !== 'undefined' ? window.location.origin : '')
}

export function isReadOnlySubmissionHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/, '')
  return normalizedHostname === 'pages.dev' || normalizedHostname.endsWith('.pages.dev')
}

/**
 * Cloudflare Pages preview and immutable deployment hostnames intentionally
 * expose only the static, read-only application. The canonical custom domain
 * and local development origins may render the authenticated submission flow.
 */
export function isSubmissionReadOnlyEnvironment(): boolean {
  if (import.meta.env.VITE_APP_ENV === 'preview') {
    return true
  }

  return typeof window !== 'undefined' && isReadOnlySubmissionHostname(window.location.hostname)
}

export function shouldUseMockPlayer(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).has('mockPlayer')
}
