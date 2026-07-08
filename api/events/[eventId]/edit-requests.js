import { createEditRequestIssue } from '../../_github.js'
import { handleOptions, json, readBody, requireMethod, setCors } from '../../_http.js'
import { readSession } from '../../_session.js'
import { verifyTurnstileToken } from '../../_turnstile.js'

export default async function handler(req, res) {
  if (handleOptions(req, res)) {
    return
  }
  setCors(req, res)
  if (!requireMethod(req, res, 'POST')) {
    return
  }

  const session = readSession(req)
  if (!session?.login) {
    json(res, 401, { error: 'github_login_required' })
    return
  }

  try {
    const body = readBody(req)

    const isValidToken = await verifyTurnstileToken(body.turnstileToken, req)
    if (!isValidToken) {
      json(res, 400, { error: 'invalid_bot_token', message: '보안 검증에 실패했습니다. 새로고침 후 다시 시도해 주세요.' })
      return
    }

    const eventId = String(req.query.eventId || body.eventId || '')
    const message = String(body.message || '')
    if (!eventId || !message) {
      json(res, 400, { error: 'eventId and message are required' })
      return
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eventId) || eventId.length > 100) {
      json(res, 400, { error: 'invalid_event_id', message: 'eventId must be a valid slug (lowercase letters, numbers, hyphens) and 100 characters or less' })
      return
    }

    if (message.length > 2000) {
      json(res, 400, { error: 'invalid_message', message: 'message must be 2000 characters or less' })
      return
    }

    if (body.occurrenceId && String(body.occurrenceId).length > 50) {
      json(res, 400, { error: 'invalid_occurrence_id', message: 'occurrenceId must be 50 characters or less' })
      return
    }

    if (body.sourceUrl) {
      const sourceUrlStr = String(body.sourceUrl)
      if (sourceUrlStr.length > 500 || !/^https?:\/\//.test(sourceUrlStr)) {
        json(res, 400, { error: 'invalid_source_url', message: 'sourceUrl must be a valid HTTP URL and 500 characters or less' })
        return
      }
    }

    const issue = await createEditRequestIssue({
      eventId,
      message,
      occurrenceId: body.occurrenceId ? String(body.occurrenceId) : undefined,
      sourceUrl: body.sourceUrl ? String(body.sourceUrl) : undefined,
      submitter: session.login,
    })
    json(res, 200, { url: issue.html_url })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'edit_request_failed' })
  }
}
