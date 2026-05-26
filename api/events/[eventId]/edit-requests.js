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
