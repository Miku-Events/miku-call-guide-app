import { clearAllAuthCookies } from '../_session.js'
import { handleOptions, requireMethod, setCors } from '../_http.js'

export default function handler(req, res) {
  if (handleOptions(req, res)) {
    return
  }
  setCors(req, res)
  if (!requireMethod(req, res, 'POST')) {
    return
  }

  clearAllAuthCookies(res)
  res.status(204).end()
}
