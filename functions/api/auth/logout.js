import { createApiHandler, emptyResponse } from '../../_lib/http.js'
import { clearAllAuthCookies } from '../../_lib/session.js'
import { requireCanonicalProductionRequest } from '../../_lib/runtimePolicy.js'

export const onRequest = createApiHandler({ method: 'POST' }, ({ request, env, headers }) => {
  requireCanonicalProductionRequest(request, env, { requireOriginHeader: true })
  clearAllAuthCookies(headers)
  return emptyResponse(204, headers)
})
