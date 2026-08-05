import { useCallback, useEffect, useRef, useState } from 'react'

export type ObserveCatalogThumbnail = (target: Element, songId: string) => () => void

interface CatalogThumbnailObserver {
  loadedSongIds: ReadonlySet<string>
  markThumbnailLoaded: (songId: string) => void
  observeThumbnail: ObserveCatalogThumbnail
  resetThumbnailVersion: (dataVersion: string) => void
}

export function useCatalogThumbnailObserver(): CatalogThumbnailObserver {
  const [loadedSongIds, setLoadedSongIds] = useState<ReadonlySet<string>>(() => new Set())
  const dataVersionRef = useRef<string | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const songIdsByTargetRef = useRef(new Map<Element, string>())

  const markThumbnailLoaded = useCallback((songId: string) => {
    setLoadedSongIds((current) => {
      if (current.has(songId)) {
        return current
      }
      const next = new Set(current)
      next.add(songId)
      return next
    })
  }, [])

  const observeThumbnail = useCallback<ObserveCatalogThumbnail>((target, songId) => {
    if (typeof IntersectionObserver === 'undefined') {
      markThumbnailLoaded(songId)
      return () => undefined
    }

    songIdsByTargetRef.current.set(target, songId)
    if (!observerRef.current) {
      const root = target.closest('.app-main')
      observerRef.current = new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue
          }
          const targetSongId = songIdsByTargetRef.current.get(entry.target)
          if (targetSongId) {
            markThumbnailLoaded(targetSongId)
            songIdsByTargetRef.current.delete(entry.target)
          }
          observer.unobserve(entry.target)
        }
      }, {
        root,
        rootMargin: '200px 0px',
        threshold: 0.01,
      })
    }

    observerRef.current.observe(target)
    return () => {
      observerRef.current?.unobserve(target)
      songIdsByTargetRef.current.delete(target)
    }
  }, [markThumbnailLoaded])

  const resetThumbnailVersion = useCallback((dataVersion: string) => {
    if (dataVersionRef.current === dataVersion) {
      return
    }
    dataVersionRef.current = dataVersion
    observerRef.current?.disconnect()
    observerRef.current = null
    songIdsByTargetRef.current.clear()
    setLoadedSongIds(new Set())
  }, [])

  useEffect(() => () => {
    observerRef.current?.disconnect()
    observerRef.current = null
    songIdsByTargetRef.current.clear()
  }, [])

  return {
    loadedSongIds,
    markThumbnailLoaded,
    observeThumbnail,
    resetThumbnailVersion,
  }
}
