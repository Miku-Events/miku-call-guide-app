import {
  canonicalProductionOrigin,
  canonicalSecureHostname,
} from './productionHostname.js'
import { importGitHubAppPrivateKey } from './github-private-key.js'

const SESSION_SECRET_MINIMUM_BYTES = 32
const PRODUCTION_APP_ORIGIN = 'https://miku-call-guide-app.pages.dev'
const OFFICIAL_TURNSTILE_TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
])

export const READINESS_CONTRACT_HEADER = 'x-miku-readiness-contract'
export const READINESS_CONTRACT_VERSION = 'runtime-config-v1'

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase()
  return normalized === 'changeme'
    || normalized === 'change-me'
    || normalized === 'secret'
    || normalized.includes('placeholder')
    || normalized.startsWith('replace-with-')
    || normalized.startsWith('replace_with_')
    || normalized.startsWith('your-')
    || normalized.startsWith('your_')
}

function requiredValue(environment, name, { secret = false } = {}) {
  const value = environment?.[name]
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error('invalid_runtime_configuration')
  }
  if ((secret || name.startsWith('GITHUB_')) && isPlaceholder(value)) {
    throw new Error('invalid_runtime_configuration')
  }
  return value
}

function productionOrigin(environment) {
  const value = requiredValue(environment, 'APP_ORIGIN')
  const origin = canonicalProductionOrigin(value)
  if (!origin || origin !== PRODUCTION_APP_ORIGIN) {
    throw new Error('invalid_runtime_configuration')
  }
  return new URL(origin)
}

function validateSessionSecret(environment) {
  const value = requiredValue(environment, 'SESSION_SECRET', { secret: true })
  if (new TextEncoder().encode(value).byteLength < SESSION_SECRET_MINIMUM_BYTES) {
    throw new Error('invalid_runtime_configuration')
  }
}

function validateTurnstile(environment, appOrigin) {
  const secret = requiredValue(environment, 'CLOUDFLARE_TURNSTILE_SECRET_KEY', { secret: true })
  if (OFFICIAL_TURNSTILE_TEST_SECRETS.has(secret)) {
    throw new Error('invalid_runtime_configuration')
  }

  const hostname = canonicalSecureHostname(
    requiredValue(environment, 'TURNSTILE_EXPECTED_HOSTNAME'),
  )
  if (
    !hostname
    || hostname !== appOrigin.hostname.toLowerCase()
  ) {
    throw new Error('invalid_runtime_configuration')
  }
}

async function validateGitHubPrivateKey(environment) {
  try {
    await importGitHubAppPrivateKey(environment?.GITHUB_APP_PRIVATE_KEY)
  } catch {
    throw new Error('invalid_runtime_configuration')
  }
}

async function validateGitHub(environment) {
  const appId = requiredValue(environment, 'GITHUB_APP_ID')
  const installationId = requiredValue(environment, 'GITHUB_APP_INSTALLATION_ID')
  if (!/^\d+$/.test(appId) || !/^\d+$/.test(installationId)) {
    throw new Error('invalid_runtime_configuration')
  }

  const owner = requiredValue(environment, 'GITHUB_DATA_OWNER')
  const repository = requiredValue(environment, 'GITHUB_DATA_REPO')
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)
    || !/^[A-Za-z0-9._-]{1,100}$/.test(repository)
  ) {
    throw new Error('invalid_runtime_configuration')
  }

  requiredValue(environment, 'GITHUB_OAUTH_CLIENT_ID')
  requiredValue(environment, 'GITHUB_OAUTH_CLIENT_SECRET', { secret: true })
  await validateGitHubPrivateKey(environment)
}

export async function parseRuntimeConfig(environment, mode = 'service') {
  if (!environment || typeof environment !== 'object') {
    throw new Error('invalid_runtime_configuration')
  }

  if (mode !== 'readiness') return environment
  if (environment.APP_ENV !== 'production') {
    throw new Error('invalid_runtime_configuration')
  }

  const appOrigin = productionOrigin(environment)
  validateSessionSecret(environment)
  validateTurnstile(environment, appOrigin)
  await validateGitHub(environment)
  return environment
}

export async function assertProductionReadiness(environment) {
  await parseRuntimeConfig(environment, 'readiness')
}
