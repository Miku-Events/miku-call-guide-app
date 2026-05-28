import { cloudflareAdapter } from '../_adapter.js'
import originalHandler from '../../../api/auth/session.js'

export const onRequest = cloudflareAdapter(originalHandler)
