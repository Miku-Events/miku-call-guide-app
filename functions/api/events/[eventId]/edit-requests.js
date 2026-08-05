import { createEditRequestIssue } from '../../../_lib/github.js'
import { createApiHandler, HttpError, jsonResponse } from '../../../_lib/http.js'
import { readSession } from '../../../_lib/session.js'
import { verifyTurnstileToken } from '../../../_lib/turnstile.js'

export function createEditRequestHandler(dependencies = {}) {
  const createIssue = dependencies.createEditRequestIssue || createEditRequestIssue
  const readRequestSession = dependencies.readSession || readSession
  const verifyToken = dependencies.verifyTurnstileToken || verifyTurnstileToken

  return createApiHandler({
    method: 'POST',
    jsonBody: true,
    fallback: { code: 'github_upstream_failed', status: 502 },
  }, async (context) => {
    const { request, env, params, body, headers } = context
    let session
    try {
      session = readRequestSession(request, env)
    } catch {
      throw new HttpError(503, 'session_not_configured')
    }
    if (!session?.login) throw new HttpError(401, 'github_login_required')
    context.authUser = session.login

    if (!await verifyToken(body.turnstileToken, request, env, 'event_edit')) {
      throw new HttpError(400, 'invalid_bot_token')
    }

    const eventId = String(params.eventId || body.eventId || '')
    const message = String(body.message || '')
    if (!eventId || !message) {
      throw new HttpError(400, 'invalid_edit_request', ['eventId and message are required'])
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eventId) || eventId.length > 100) {
      throw new HttpError(400, 'invalid_event_id', ['eventId must be a valid slug (lowercase letters, numbers, hyphens) and 100 characters or less'])
    }
    if (message.length > 2000) {
      throw new HttpError(400, 'invalid_message', ['message must be 2000 characters or less'])
    }
    if (body.occurrenceId && String(body.occurrenceId).length > 50) {
      throw new HttpError(400, 'invalid_occurrence_id', ['occurrenceId must be 50 characters or less'])
    }
    if (body.sourceUrl) {
      const sourceUrl = String(body.sourceUrl)
      if (sourceUrl.length > 500 || !/^https?:\/\//.test(sourceUrl)) {
        throw new HttpError(400, 'invalid_source_url', ['sourceUrl must be a valid HTTP URL and 500 characters or less'])
      }
    }

    const issue = await createIssue({
      eventId,
      message,
      occurrenceId: body.occurrenceId ? String(body.occurrenceId) : undefined,
      sourceUrl: body.sourceUrl ? String(body.sourceUrl) : undefined,
      submitter: session.login,
    }, env)
    return jsonResponse({ url: issue.html_url }, 200, headers)
  })
}

export const onRequest = createEditRequestHandler()
