import { createState } from '../../_session.js'

export function safeReturnTo(value) {
  const fallback = process.env.APP_ORIGIN || '/'
  if (typeof value !== 'string' || !value) {
    return fallback
  }

  try {
    const base = process.env.APP_ORIGIN || 'http://localhost'
    const baseOrigin = new URL(base).origin
    const url = new URL(value, baseOrigin)
    if (url.origin === baseOrigin) {
      return url.pathname + url.search + url.hash
    }
  } catch {}

  return fallback
}

export default function handler(req, res) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID
  if (!clientId) {
    res.status(500).json({ error: 'github_oauth_not_configured' })
    return
  }

  const returnTo = safeReturnTo(req.query.returnTo)
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', 'read:user')
  url.searchParams.set('state', createState(returnTo))
  res.redirect(url.toString())
}
