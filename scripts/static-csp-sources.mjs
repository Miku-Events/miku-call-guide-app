export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'
export const CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN = 'https://static.cloudflareinsights.com'
export const CLOUDFLARE_WEB_ANALYTICS_COLLECTOR_ORIGIN = 'https://cloudflareinsights.com'

// Cloudflare Google Tag Gateway automatic setup injects these two exact inline
// bootstraps before the application entry. Keep them hash-scoped: never replace
// them with unsafe-inline. The production browser smoke detects configuration
// changes that would require refreshing these hashes.
export const GOOGLE_TAG_GATEWAY_SCRIPT_HASHES = Object.freeze([
  "'sha256-hVajfYfCCiKE0tyiHJsO6QZ7neDSGvNU29XVzmGcyAU='",
  "'sha256-UxvldURLmbwK98B86I+nlncBxT8RepUWLzN0DTl03tk='",
])
export const GOOGLE_TAG_GATEWAY_SCRIPT_ORIGIN = 'https://www.googletagmanager.com'
export const GOOGLE_TAG_GATEWAY_COLLECTOR_ORIGIN = 'https://www.google-analytics.com'

export const YOUTUBE_SCRIPT_ORIGINS = Object.freeze([
  'https://www.youtube.com',
  'https://s.ytimg.com',
])
export const YOUTUBE_FRAME_ORIGINS = Object.freeze([
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
])
export const X_ORIGINS = Object.freeze([
  'https://platform.x.com',
  'https://platform.twitter.com',
  'https://syndication.twitter.com',
  'https://cdn.syndication.twimg.com',
])
