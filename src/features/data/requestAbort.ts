export function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) {
    return signal.reason
  }
  return new DOMException('The operation was aborted.', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}

export function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) {
    return () => undefined
  }
  if (source.aborted) {
    target.abort(abortReason(source))
    return () => undefined
  }
  const abort = () => target.abort(abortReason(source))
  source.addEventListener('abort', abort, { once: true })
  return () => source.removeEventListener('abort', abort)
}
