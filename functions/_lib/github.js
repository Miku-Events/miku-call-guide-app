import { HttpError } from './http.js'
import { importGitHubAppPrivateKey } from './github-private-key.js'

const apiBase = 'https://api.github.com'
export const GITHUB_TIMEOUT_MS = 10_000
 
function requiredEnv(name, environment) {
  const value = environment?.[name]
  if (!value) {
    throw new HttpError(
      503,
      name.startsWith('GITHUB_OAUTH_')
        ? 'github_oauth_not_configured'
        : 'github_app_not_configured',
    )
  }
  return value
}
 
function base64UrlJson(value) {
  const jsonStr = JSON.stringify(value)
  const bytes = new TextEncoder().encode(jsonStr)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const b64 = btoa(binary)
  return b64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// Convert ArrayBuffer to base64url string
function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Creates a JWT for GitHub App authentication using standard Web Crypto API.
 * This runs flawlessly on Cloudflare Pages Functions, Node, and Vercel Edge.
 */
async function appJwt(environment) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: requiredEnv('GITHUB_APP_ID', environment),
  })
  const content = `${header}.${payload}`
  
  const cryptoKey = await importGitHubAppPrivateKey(
    requiredEnv('GITHUB_APP_PRIVATE_KEY', environment),
  )
  
  // Sign the content
  const encoder = new TextEncoder()
  const contentBuffer = encoder.encode(content)
  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    contentBuffer
  )
  
  const signature = arrayBufferToBase64Url(signatureBuffer)
  return `${content}.${signature}`
}

function upstreamError(status = 502) {
  return new HttpError(
    status,
    status === 503 ? 'github_upstream_unavailable' : 'github_upstream_failed',
  )
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function withTimeout(externalSignal, operation) {
  const controller = new AbortController()
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) {
    abortFromExternalSignal()
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true })
  }
  const abortPromise = new Promise((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(upstreamError(503)), {
      once: true,
    })
  })
  const timeout = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS)

  try {
    return await Promise.race([
      operation(controller.signal),
      abortPromise,
    ])
  } catch (error) {
    if (error instanceof HttpError) {
      throw error
    }
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw upstreamError(503)
    }
    throw upstreamError(502)
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromExternalSignal)
  }
}

async function parseJsonResponse(response) {
  try {
    const result = await response.json()
    if (!isRecord(result)) {
      throw new Error('Unexpected response shape')
    }
    return result
  } catch {
    throw upstreamError(502)
  }
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel()
  } catch {
    // The upstream status is already known; cleanup failure must not expose details.
  }
}

async function githubFetch(path, options = {}) {
  return withTimeout(options.signal, async (signal) => {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'User-Agent': 'miku-call-guide-app',
        ...options.headers,
      },
      signal,
    })

    if (!response.ok) {
      await cancelResponseBody(response)
      throw upstreamError(502)
    }

    return response.status === 204 ? null : parseJsonResponse(response)
  })
}

export async function installationToken(environment) {
  const installationId = requiredEnv('GITHUB_APP_INSTALLATION_ID', environment)
  let jwt
  try {
    jwt = await appJwt(environment)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(503, 'github_app_not_configured')
  }
  const result = await githubFetch(`/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}` },
  })
  if (typeof result?.token !== 'string' || !result.token) {
    throw upstreamError(502)
  }
  return result.token
}

export async function exchangeOAuthCode(code, codeVerifier, environment) {
  return withTimeout(undefined, async (signal) => {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      body: JSON.stringify({
        client_id: requiredEnv('GITHUB_OAUTH_CLIENT_ID', environment),
        client_secret: requiredEnv('GITHUB_OAUTH_CLIENT_SECRET', environment),
        code,
        code_verifier: codeVerifier,
      }),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'User-Agent': 'miku-call-guide-app',
      },
      method: 'POST',
      signal,
    })
    if (!response.ok) {
      await cancelResponseBody(response)
      throw upstreamError(502)
    }

    const data = await parseJsonResponse(response)
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw upstreamError(502)
    }
    return data.access_token
  })
}

export async function fetchGitHubUser(accessToken, environment) {
  if (!environment || typeof environment !== 'object') {
    throw new HttpError(503, 'github_oauth_not_configured')
  }
  const user = await githubFetch('/user', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (
    !user
    || (typeof user.id !== 'number' && typeof user.id !== 'string')
    || typeof user.login !== 'string'
    || !user.login
  ) {
    throw upstreamError(502)
  }
  return user
}

export function repoConfig(environment) {
  return {
    owner: requiredEnv('GITHUB_DATA_OWNER', environment),
    repo: requiredEnv('GITHUB_DATA_REPO', environment),
    baseBranch: environment.GITHUB_DATA_BASE_BRANCH || 'main',
  }
}

export async function createEventPullRequest({ branchName, content, filePath, title, submitter }, environment) {
  const token = await installationToken(environment)
  const { owner, repo, baseBranch } = repoConfig(environment)
  const headers = { authorization: `Bearer ${token}` }
  const baseRef = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, { headers })
  if (typeof baseRef?.object?.sha !== 'string' || !baseRef.object.sha) {
    throw upstreamError(502)
  }

  await githubFetch(`/repos/${owner}/${repo}/git/refs`, {
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: baseRef.object.sha,
    }),
    headers,
    method: 'POST',
  })

  await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}`, {
    body: JSON.stringify({
      branch: branchName,
      content: base64Encode(content),
      message: `Add event: ${title}`,
    }),
    headers,
    method: 'PUT',
  })

  const pullRequest = await githubFetch(`/repos/${owner}/${repo}/pulls`, {
    body: JSON.stringify({
      base: baseBranch,
      body: `Submitted from the web event form.\n\nSubmitted by: @${submitter}`,
      head: branchName,
      title: `Add event: ${title}`,
    }),
    headers,
    method: 'POST',
  })
  if (typeof pullRequest?.html_url !== 'string' || !pullRequest.html_url) {
    throw upstreamError(502)
  }
  return pullRequest
}

export async function createEditRequestIssue({ eventId, occurrenceId, message, sourceUrl, submitter }, environment) {
  const token = await installationToken(environment)
  const { owner, repo } = repoConfig(environment)
  const issue = await githubFetch(`/repos/${owner}/${repo}/issues`, {
    body: JSON.stringify({
      body: [
        `Submitted by: @${submitter}`,
        `Event id: ${eventId}`,
        occurrenceId ? `Occurrence id: ${occurrenceId}` : null,
        sourceUrl ? `Source URL: ${sourceUrl}` : null,
        '',
        message,
      ]
        .filter(Boolean)
        .join('\n'),
      labels: ['event-edit-request'],
      title: `Event edit request: ${eventId}`,
    }),
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
  })
  if (typeof issue?.html_url !== 'string' || !issue.html_url) {
    throw upstreamError(502)
  }
  return issue
}
