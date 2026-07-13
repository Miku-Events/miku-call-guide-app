import { cloudflareAdapter } from './_adapter.js'
import originalHandler from '../../api/ready.js'

export const onRequest = cloudflareAdapter(originalHandler)
