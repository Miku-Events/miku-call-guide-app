import { createApiHandler, HttpError, jsonResponse } from '../_lib/http.js'
import {
  assertProductionReadiness,
  READINESS_CONTRACT_HEADER,
  READINESS_CONTRACT_VERSION,
} from '../_lib/runtimeConfig.js'

export const onRequest = createApiHandler({
  method: 'GET',
  fallback: { code: 'service_not_ready', status: 503 },
  headers: { [READINESS_CONTRACT_HEADER]: READINESS_CONTRACT_VERSION },
}, async ({ env, headers }) => {
  try {
    await assertProductionReadiness(env)
  } catch {
    throw new HttpError(503, 'service_not_ready')
  }
  return jsonResponse({ ready: true }, 200, headers)
})
