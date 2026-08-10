export interface SubmissionSession {
  authenticated: boolean
  id?: string
  login?: string
}

export interface EventSubmissionPayload {
  title: string
  type: string
  startsAt?: string
  endsAt?: string
  startsOn?: string
  endsOn?: string
  timezone: string
  snsUrl: string
  sourceUrl?: string
  note?: string
  slug?: string
  attributionConsent: true
  turnstileToken: string
}

export interface EditRequestPayload {
  eventId: string
  occurrenceId?: string
  message: string
  sourceUrl?: string
  attributionConsent: true
  turnstileToken: string
}

export interface SubmissionResult {
  replayed: boolean
  url?: string
}

interface ApiErrorBody {
  error?: unknown
  requestId?: unknown
}

export class SubmissionApiError extends Error {
  readonly code?: string
  readonly requestId?: string
  readonly retryAfter?: string
  readonly status: number

  constructor(options: {
    code?: string
    message: string
    requestId?: string
    retryAfter?: string
    status: number
  }) {
    super(options.message)
    this.name = 'SubmissionApiError'
    this.code = options.code
    this.requestId = options.requestId
    this.retryAfter = options.retryAfter
    this.status = options.status
  }
}

export interface SubmissionErrorPresentation {
  message: string
  requestId?: string
  retryGuidance: string
}

function apiUrl(apiBaseUrl: string, path: string): string {
  return new URL(path, apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`).toString()
}

function isJsonMediaType(response: Response): boolean {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || Boolean(mediaType?.endsWith('+json'))
}

async function readApiError(response: Response): Promise<SubmissionApiError> {
  let body: ApiErrorBody = {}
  if (isJsonMediaType(response)) {
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      body = {}
    }
  }

  const code = typeof body.error === 'string' ? body.error : undefined
  const requestId = typeof body.requestId === 'string'
    ? body.requestId
    : response.headers.get('x-request-id') || undefined

  return new SubmissionApiError({
    code,
    message: code ? `Submission request failed: ${code}.` : `Submission request failed with ${response.status}.`,
    requestId,
    retryAfter: response.headers.get('retry-after') || undefined,
    status: response.status,
  })
}

function retryAfterGuidance(retryAfter: string | undefined): string {
  if (!retryAfter) {
    return '잠시 후 다시 시도해 주세요.'
  }

  const seconds = Number(retryAfter)
  return Number.isFinite(seconds) && seconds > 0
    ? `${Math.ceil(seconds)}초 후 다시 시도해 주세요.`
    : '잠시 후 다시 시도해 주세요.'
}

export function submissionErrorPresentation(
  error: unknown,
  fallbackMessage: string,
): SubmissionErrorPresentation {
  if (!(error instanceof SubmissionApiError)) {
    return {
      message: error instanceof Error ? error.message : fallbackMessage,
      retryGuidance: '보안 검증을 다시 완료한 뒤 재시도해 주세요.',
    }
  }

  if (error.status === 409) {
    return {
      message: '이미 같은 일정이 등록되어 있거나 처리 중입니다.',
      requestId: error.requestId,
      retryGuidance: '기존 일정과 제출 내역을 확인한 뒤, 내용이 다를 때만 다시 시도해 주세요.',
    }
  }

  if (error.status === 429) {
    return {
      message: error.requestId
        ? '요청이 너무 많아 일시적으로 제한되었습니다.'
        : 'Cloudflare 보호 계층에서 요청을 일시적으로 제한했습니다.',
      requestId: error.requestId,
      retryGuidance: retryAfterGuidance(error.retryAfter),
    }
  }

  if (error.status === 403 && error.code === 'submissions_disabled') {
    return {
      message: '현재 일정 제보와 수정 요청 기능이 일시 중지되어 있습니다.',
      requestId: error.requestId,
      retryGuidance: '읽기 기능은 계속 이용할 수 있습니다. 운영자가 기능을 다시 열 때까지 기다려 주세요.',
    }
  }

  return {
    message: fallbackMessage,
    requestId: error.requestId,
    retryGuidance: '보안 검증을 다시 완료한 뒤 재시도해 주세요.',
  }
}

export async function fetchSubmissionSession(apiBaseUrl: string, signal?: AbortSignal): Promise<SubmissionSession> {
  if (!apiBaseUrl) {
    return { authenticated: false }
  }

  const response = await fetch(apiUrl(apiBaseUrl, 'api/auth/session'), { credentials: 'include', signal })
  if (!response.ok) {
    return { authenticated: false }
  }

  const data = (await response.json()) as {
    authenticated?: unknown
    id?: unknown
    login?: unknown
  }
  const id = typeof data.id === 'string'
    ? data.id
    : typeof data.id === 'number' && Number.isSafeInteger(data.id) && data.id > 0
      ? String(data.id)
      : undefined
  const login = typeof data.login === 'string' ? data.login : undefined
  return {
    authenticated: Boolean(data.authenticated && id && login),
    id,
    login,
  }
}

export function githubLoginUrl(apiBaseUrl: string, returnTo: string): string {
  const url = new URL(apiUrl(apiBaseUrl, 'api/auth/github/start'))
  url.searchParams.set('returnTo', returnTo)
  return url.toString()
}

export function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('이 브라우저에서는 안전한 제출 식별자를 생성할 수 없습니다.')
  }
  return globalThis.crypto.randomUUID()
}

async function postJson(
  apiBaseUrl: string,
  path: string,
  body: unknown,
  idempotencyKey: string,
): Promise<SubmissionResult> {
  if (!apiBaseUrl) {
    throw new Error('Submission API is not configured.')
  }

  const response = await fetch(apiUrl(apiBaseUrl, path), {
    body: JSON.stringify(body),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    method: 'POST',
  })

  if (!response.ok) {
    throw await readApiError(response)
  }

  const data = (await response.json()) as { url?: unknown }
  return {
    replayed: response.headers.get('idempotency-replayed')?.toLowerCase() === 'true',
    url: typeof data.url === 'string' ? data.url : undefined,
  }
}

export async function logoutSubmissionSession(apiBaseUrl: string): Promise<void> {
  if (!apiBaseUrl) {
    throw new Error('Submission API is not configured.')
  }

  const response = await fetch(apiUrl(apiBaseUrl, 'api/auth/logout'), {
    credentials: 'include',
    method: 'POST',
  })
  if (!response.ok) {
    throw await readApiError(response)
  }
}

export function submitEventSubmission(
  apiBaseUrl: string,
  payload: EventSubmissionPayload,
  idempotencyKey: string,
): Promise<SubmissionResult> {
  return postJson(apiBaseUrl, 'api/events/submissions', payload, idempotencyKey)
}

export function submitEditRequest(
  apiBaseUrl: string,
  payload: EditRequestPayload,
  idempotencyKey: string,
): Promise<SubmissionResult> {
  return postJson(
    apiBaseUrl,
    `api/events/${encodeURIComponent(payload.eventId)}/edit-requests`,
    payload,
    idempotencyKey,
  )
}
