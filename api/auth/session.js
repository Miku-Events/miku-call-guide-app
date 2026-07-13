import {
  handleOptions,
  json,
  requireMethod,
  respondWithError,
  setCors,
} from '../_http.js'
import { readSession } from '../_session.js'

export default function handler(req, res) {
  if (handleOptions(req, res)) {
    return
  }
  setCors(req, res)
  if (!requireMethod(req, res, 'GET')) {
    return
  }

  try {
    const session = readSession(req, req.env)
    json(res, 200, {
      authenticated: Boolean(session?.login),
      login: session?.login,
    })
  } catch (error) {
    respondWithError(req, res, error, {
      code: 'session_not_configured',
      status: 503,
    })
  }
}
