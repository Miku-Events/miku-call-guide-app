import { createState } from '../../_session.js'

function safeReturnTo(value) {
  const fallback = process.env.APP_ORIGIN || '/'
  if (typeof value !== 'string' || !value) {
    return fallback
  }

  if (value.startsWith('/') && !value.startsWith('//')) {
    return value
  }

  if (!process.env.APP_ORIGIN) {
    return fallback
  }

  try {
    const url = new URL(value)
    return url.origin === process.env.APP_ORIGIN ? url.toString() : fallback
  } catch {
    return fallback
  }
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
