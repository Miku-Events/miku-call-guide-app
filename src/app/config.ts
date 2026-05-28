const devManifestUrl = 'http://localhost:4174/manifest.json'

export function getRootManifestUrl(): string {
  return import.meta.env.VITE_DATA_MANIFEST_URL ?? import.meta.env.VITE_CALL_GUIDE_MANIFEST_URL ?? (import.meta.env.DEV ? devManifestUrl : '')
}

export function getManifestUrl(): string {
  return getRootManifestUrl()
}

export function getSubmissionApiBaseUrl(): string {
  return import.meta.env.VITE_SUBMISSION_API_URL || (typeof window !== 'undefined' ? window.location.origin : '')
}

export function shouldUseMockPlayer(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).has('mockPlayer')
}
