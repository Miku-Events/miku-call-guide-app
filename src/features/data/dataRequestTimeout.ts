export const CALL_GUIDE_LOAD_DEADLINE_MS = 15_000
export const DATA_REQUEST_TIMEOUT_MS = 10_000

export type DataRequestKind = 'manifest' | 'resource' | 'song'

const timeoutLabels: Record<DataRequestKind, string> = {
  manifest: 'Call-guide manifest',
  resource: 'Data resource',
  song: 'Song data',
}

export class DataRequestTimeoutError extends Error {
  readonly code = 'DATA_REQUEST_TIMEOUT'
  readonly kind: DataRequestKind
  readonly timeoutMs: number

  constructor(kind: DataRequestKind, timeoutMs = CALL_GUIDE_LOAD_DEADLINE_MS) {
    super(`${timeoutLabels[kind]} request timed out after ${timeoutMs / 1_000} seconds.`)
    this.name = 'TimeoutError'
    this.kind = kind
    this.timeoutMs = timeoutMs
  }
}

export function dataRequestTimeoutReason(signal: AbortSignal | undefined): DataRequestTimeoutError | null {
  if (!signal?.aborted || !(signal.reason instanceof DataRequestTimeoutError)) {
    return null
  }
  return signal.reason
}
