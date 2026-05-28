import { cloudflareAdapter } from '../../_adapter.js'
import originalHandler from '../../../../api/events/[eventId]/edit-requests.js'

export const onRequest = cloudflareAdapter(originalHandler)
