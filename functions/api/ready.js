import { createHash } from 'node:crypto'
import { createApiHandler, HttpError, jsonResponse } from '../_lib/http.js'
import {
  assertProductionReadiness,
  READINESS_CONTRACT_HEADER,
  READINESS_CONTRACT_VERSION,
} from '../_lib/runtimeConfig.js'

const SUCCESS_CACHE_MS = 60_000
const FAILURE_CACHE_MS = 5_000
const READINESS_KEYS = [
  'APP_ENV',
  'APP_ORIGIN',
  'CLOUDFLARE_TURNSTILE_SECRET_KEY',
  'GITHUB_APP_ID',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_DATA_OWNER',
  'GITHUB_DATA_REPO',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'SESSION_SECRET',
  'SUBMISSION_WRITES_ENABLED',
]
let readinessCache = new Map()

function cacheKey(environment) {
  const hash = createHash('sha256')
  for (const name of READINESS_KEYS) {
    const value = typeof environment?.[name] === 'string' ? environment[name] : ''
    hash.update(`${name.length}:${name}:${value.length}:`)
    hash.update(value)
  }
  return hash.digest('hex')
}

export async function cachedProductionReadiness(environment, options = {}) {
  const now = options.now ?? Date.now()
  const validate = options.validate || assertProductionReadiness
  const key = cacheKey(environment)
  const cached = readinessCache.get(key)
  if (cached && cached.expiresAt > now) return cached.ready

  try {
    await validate(environment)
    readinessCache.set(key, { expiresAt: now + SUCCESS_CACHE_MS, ready: true })
    return true
  } catch {
    readinessCache.set(key, { expiresAt: now + FAILURE_CACHE_MS, ready: false })
    return false
  }
}

export function resetReadinessCacheForTests() {
  readinessCache = new Map()
}

export const onRequest = createApiHandler({
  method: 'GET',
  fallback: { code: 'service_not_ready', status: 503 },
  headers: { [READINESS_CONTRACT_HEADER]: READINESS_CONTRACT_VERSION },
}, async ({ env, headers }) => {
  if (!await cachedProductionReadiness(env)) {
    throw new HttpError(503, 'service_not_ready')
  }
  return jsonResponse({ ready: true }, 200, headers)
})
