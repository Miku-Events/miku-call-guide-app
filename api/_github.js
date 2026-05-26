import { createSign } from 'node:crypto'

const apiBase = 'https://api.github.com'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not configured`)
  }
  return value
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function appJwt() {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: requiredEnv('GITHUB_APP_ID'),
  })
  const content = `${header}.${payload}`
  const privateKey = requiredEnv('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n')
  const signature = createSign('RSA-SHA256').update(content).sign(privateKey, 'base64url')
  return `${content}.${signature}`
}

async function githubFetch(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GitHub API ${path} failed with ${response.status}: ${body}`)
  }

  return response.status === 204 ? null : response.json()
}

export async function installationToken() {
  const installationId = requiredEnv('GITHUB_APP_INSTALLATION_ID')
  const result = await githubFetch(`/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { authorization: `Bearer ${appJwt()}` },
  })
  return result.token
}

export async function exchangeOAuthCode(code) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    body: JSON.stringify({
      client_id: requiredEnv('GITHUB_OAUTH_CLIENT_ID'),
      client_secret: requiredEnv('GITHUB_OAUTH_CLIENT_SECRET'),
      code,
    }),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`GitHub OAuth exchange failed with ${response.status}`)
  }

  const data = await response.json()
  if (!data.access_token) {
    throw new Error('GitHub OAuth exchange did not return an access token')
  }
  return data.access_token
}

export async function fetchGitHubUser(accessToken) {
  return githubFetch('/user', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
}

export function repoConfig() {
  return {
    owner: requiredEnv('GITHUB_DATA_OWNER'),
    repo: requiredEnv('GITHUB_DATA_REPO'),
    baseBranch: process.env.GITHUB_DATA_BASE_BRANCH || 'main',
  }
}

export async function createEventPullRequest({ branchName, content, filePath, title, submitter }) {
  const token = await installationToken()
  const { owner, repo, baseBranch } = repoConfig()
  const headers = { authorization: `Bearer ${token}` }
  const baseRef = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, { headers })

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
      content: Buffer.from(content, 'utf8').toString('base64'),
      message: `Add event: ${title}`,
    }),
    headers,
    method: 'PUT',
  })

  return githubFetch(`/repos/${owner}/${repo}/pulls`, {
    body: JSON.stringify({
      base: baseBranch,
      body: `Submitted from the web event form.\n\nSubmitted by: @${submitter}`,
      head: branchName,
      title: `Add event: ${title}`,
    }),
    headers,
    method: 'POST',
  })
}

export async function createEditRequestIssue({ eventId, occurrenceId, message, sourceUrl, submitter }) {
  const token = await installationToken()
  const { owner, repo } = repoConfig()
  return githubFetch(`/repos/${owner}/${repo}/issues`, {
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
}
