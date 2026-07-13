import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CLOUDFLARE_API_ORIGIN = 'https://api.cloudflare.com'
const CANONICAL_APP_ORIGIN = 'https://miku-call-guide-app.pages.dev'
const KNOWN_LEGACY_APP_ORIGINS = new Set(['https://miku.sekai.today'])
const PROJECT_NAME = 'miku-call-guide-app'
const REQUEST_TIMEOUT_MS = 10_000

function requiredCredential(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

async function cloudflareRequest(url, {
  apiToken,
  body,
  fetchImpl,
  method = 'GET',
}) {
  let response
  try {
    response = await fetchImpl(url, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        authorization: `Bearer ${apiToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      method,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new Error('Cloudflare Pages config request failed before receiving a response')
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Cloudflare Pages config request returned HTTP ${response.status} without JSON`)
  }
  if (!response.ok || payload?.success !== true) {
    throw new Error(`Cloudflare Pages config request returned HTTP ${response.status}`)
  }
  return payload.result
}

function productionAppOriginBinding(project) {
  const environment = project?.deployment_configs?.production?.env_vars
  if (!environment || !Object.prototype.hasOwnProperty.call(environment, 'APP_ORIGIN')) {
    return undefined
  }
  return environment.APP_ORIGIN
}

function isRecognizedLegacyBinding(binding) {
  if (binding?.type === 'secret_text') return true
  return binding?.type === 'plain_text'
    && KNOWN_LEGACY_APP_ORIGINS.has(binding.value)
}

export async function removeLegacyDashboardAppOrigin({
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!requiredCredential(accountId) || !requiredCredential(apiToken)) {
    throw new Error('Cloudflare Pages credentials are required')
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required')
  }

  const endpoint = (
    `${CLOUDFLARE_API_ORIGIN}/client/v4/accounts/`
    + `${encodeURIComponent(accountId)}/pages/projects/${PROJECT_NAME}`
  )
  const project = await cloudflareRequest(endpoint, { apiToken, fetchImpl })
  const binding = productionAppOriginBinding(project)
  if (!binding) {
    return { changed: false }
  }
  if (binding.type === 'plain_text' && binding.value === CANONICAL_APP_ORIGIN) {
    return { changed: false }
  }
  if (!isRecognizedLegacyBinding(binding)) {
    throw new Error('Production APP_ORIGIN is not a recognized legacy binding')
  }

  await cloudflareRequest(endpoint, {
    apiToken,
    body: {
      deployment_configs: {
        production: {
          env_vars: { APP_ORIGIN: null },
        },
      },
    },
    fetchImpl,
    method: 'PATCH',
  })
  const updatedProject = await cloudflareRequest(endpoint, { apiToken, fetchImpl })
  if (productionAppOriginBinding(updatedProject)) {
    throw new Error('The legacy APP_ORIGIN binding is still present after reconciliation')
  }
  return { changed: true }
}

async function runCli() {
  const result = await removeLegacyDashboardAppOrigin({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  })
  process.stdout.write(result.changed
    ? 'Removed legacy production APP_ORIGIN dashboard binding.\n'
    : 'No legacy production APP_ORIGIN dashboard binding was present.\n')
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(
      `Pages configuration reconciliation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
