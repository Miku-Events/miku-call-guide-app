import { handleOptions, json, requireMethod, setCors } from '../_http.js'
import { readSession } from '../_session.js'

export default function handler(req, res) {
  if (handleOptions(req, res)) {
    return
  }
  setCors(req, res)
  if (!requireMethod(req, res, 'GET')) {
    return
  }

  const session = readSession(req)
  json(res, 200, {
    authenticated: Boolean(session?.login),
    login: session?.login,
  })
}
