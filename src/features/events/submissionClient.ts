export interface SubmissionSession {
  authenticated: boolean
  login?: string
}

export interface EventSubmissionPayload {
  title: string
  type: string
  startsAt: string
  endsAt?: string
  timezone: string
  snsUrl: string
  sourceUrl?: string
  note?: string
  turnstileToken: string
}

export interface EditRequestPayload {
  eventId: string
  occurrenceId?: string
  message: string
  sourceUrl?: string
  turnstileToken: string
}

function apiUrl(apiBaseUrl: string, path: string): string {
  return new URL(path, apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`).toString()
}

export async function fetchSubmissionSession(apiBaseUrl: string): Promise<SubmissionSession> {
  if (!apiBaseUrl) {
    return { authenticated: false }
  }

  const response = await fetch(apiUrl(apiBaseUrl, 'api/auth/session'), { credentials: 'include' })
  if (!response.ok) {
    return { authenticated: false }
  }

  const data = (await response.json()) as Partial<SubmissionSession>
  return {
    authenticated: Boolean(data.authenticated),
    login: typeof data.login === 'string' ? data.login : undefined,
  }
}

export function githubLoginUrl(apiBaseUrl: string, returnTo: string): string {
  const url = new URL(apiUrl(apiBaseUrl, 'api/auth/github/start'))
  url.searchParams.set('returnTo', returnTo)
  return url.toString()
}

async function postJson(apiBaseUrl: string, path: string, body: unknown): Promise<{ url?: string }> {
  if (!apiBaseUrl) {
    throw new Error('Submission API is not configured.')
  }

  const response = await fetch(apiUrl(apiBaseUrl, path), {
    body: JSON.stringify(body),
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Submission request failed with ${response.status}.`)
  }

  return (await response.json()) as { url?: string }
}

export function submitEventSubmission(apiBaseUrl: string, payload: EventSubmissionPayload): Promise<{ url?: string }> {
  return postJson(apiBaseUrl, 'api/events/submissions', payload)
}

export function submitEditRequest(apiBaseUrl: string, payload: EditRequestPayload): Promise<{ url?: string }> {
  return postJson(apiBaseUrl, `api/events/${encodeURIComponent(payload.eventId)}/edit-requests`, payload)
}
