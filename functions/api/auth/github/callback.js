import { cloudflareAdapter } from '../../_adapter.js'
import originalHandler from '../../../../api/auth/github/callback.js'

export const onRequest = cloudflareAdapter(originalHandler)
