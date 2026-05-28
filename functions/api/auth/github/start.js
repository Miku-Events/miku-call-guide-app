import { cloudflareAdapter } from '../../_adapter.js'
import originalHandler from '../../../../api/auth/github/start.js'

export const onRequest = cloudflareAdapter(originalHandler)
