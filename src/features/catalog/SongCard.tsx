import { memo, useEffect, useRef, type SyntheticEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import type { CatalogSongEntry } from './catalogModel'
import type { ObserveCatalogThumbnail } from './useCatalogThumbnailObserver'

interface SongCardProps {
  entry: CatalogSongEntry
  isThumbnailLoaded: boolean
  isPriorityThumbnail: boolean
  observeThumbnail: ObserveCatalogThumbnail
  onCancelHoverPrefetch: () => void
  onImmediatePrefetch: (songId: string) => void
  onScheduleHoverPrefetch: (songId: string) => void
}

function hideFailedThumbnail(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.style.display = 'none'
}

export const SongCard = memo(function SongCard({
  entry,
  isThumbnailLoaded,
  isPriorityThumbnail,
  observeThumbnail,
  onCancelHoverPrefetch,
  onImmediatePrefetch,
  onScheduleHoverPrefetch,
}: SongCardProps) {
  const mediaRef = useRef<HTMLDivElement>(null)
  const shouldRenderThumbnail = isPriorityThumbnail || isThumbnailLoaded

  useEffect(() => {
    const media = mediaRef.current
    if (!media || shouldRenderThumbnail) {
      return
    }
    return observeThumbnail(media, entry.song.id)
  }, [entry.song.id, observeThumbnail, shouldRenderThumbnail])

  return (
    <Link
      className={`catalog-song-card${entry.usesOriginalArtwork ? ' catalog-song-card--original-art' : ''}`}
      onFocus={() => onImmediatePrefetch(entry.song.id)}
      onMouseEnter={() => onScheduleHoverPrefetch(entry.song.id)}
      onMouseLeave={onCancelHoverPrefetch}
      onPointerDown={() => onImmediatePrefetch(entry.song.id)}
      to={`/songs/${entry.song.id}`}
    >
      <div className="catalog-song-media" aria-hidden="true" ref={mediaRef}>
        <div className="catalog-song-fallback-bg" />
        {shouldRenderThumbnail ? (
          <img
            alt=""
            aria-hidden="true"
            className="catalog-song-thumbnail"
            decoding="async"
            fetchPriority={isPriorityThumbnail ? 'high' : 'low'}
            loading="eager"
            onError={hideFailedThumbnail}
            src={entry.thumbnailUrl}
          />
        ) : null}
      </div>
      <div className="catalog-song-content">
        <h2>{entry.title}</h2>
        <p>{entry.artist}</p>
        <div className="catalog-card-action">
          <span>Practice</span>
          <ArrowRight size={16} aria-hidden="true" />
        </div>
      </div>
    </Link>
  )
})
