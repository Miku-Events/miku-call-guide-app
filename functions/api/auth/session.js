import { createApiHandler, jsonResponse } from '../../_lib/http.js'
import { readSession } from '../../_lib/session.js'

export const onRequest = createApiHandler({
  method: 'GET',
  fallback: { code: 'session_not_configured', status: 503 },
}, ({ request, env, headers }) => {
  const session = readSession(request, env)
  return jsonResponse({
    authenticated: Boolean(session?.id && session?.login),
    id: session?.id,
    login: session?.login,
  }, 200, headers)
})
