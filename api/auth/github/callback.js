import { exchangeOAuthCode, fetchGitHubUser } from '../../_github.js'
import { setSessionCookie, verifyState } from '../../_session.js'

export default async function handler(req, res) {
  try {
    const state = verifyState(req.query.state)
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    if (!state || !code) {
      res.status(400).json({ error: 'invalid_oauth_callback' })
      return
    }

    const accessToken = await exchangeOAuthCode(code)
    const user = await fetchGitHubUser(accessToken)
    setSessionCookie(res, {
      id: user.id,
      login: user.login,
      ts: Date.now(),
    })
    res.redirect(state.returnTo || '/')
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'github_oauth_failed' })
  }
}
