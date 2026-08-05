export function createRetryableRouteLoader<T>(importer: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | null = null

  return () => {
    if (loaded) {
      return loaded
    }

    let request: Promise<T>
    try {
      request = importer()
    } catch (error) {
      return Promise.reject(error)
    }

    const tracked = request.catch((error: unknown) => {
      if (loaded === tracked) {
        loaded = null
      }
      throw error
    })
    loaded = tracked
    return tracked
  }
}
