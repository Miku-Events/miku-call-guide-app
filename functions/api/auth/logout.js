import { cloudflareAdapter } from '../_adapter.js'
import originalHandler from '../../../api/auth/logout.js'

export const onRequest = cloudflareAdapter(originalHandler)
