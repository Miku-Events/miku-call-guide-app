import { cloudflareAdapter } from '../_adapter.js'
import originalHandler from '../../../api/events/submissions/index.js'

export const onRequest = cloudflareAdapter(originalHandler)
