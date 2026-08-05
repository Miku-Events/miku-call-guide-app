import { Skeleton } from '@astryxdesign/core/Skeleton'

export function CatalogCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="catalog-song-grid">
      {Array.from({ length: count }).map((_, index) => (
        <div className="catalog-song-card catalog-song-card--skeleton" key={index} aria-hidden="true">
          <div className="catalog-song-media relative min-h-[8rem]">
            <Skeleton width="100%" height="100%" radius={2} index={index} />
          </div>
          <div className="catalog-song-content mt-0 bg-transparent pt-4 flex flex-col gap-2">
            <Skeleton width="70%" height="1.4rem" radius={1} index={index} />
            <Skeleton width="40%" height="0.9rem" radius={1} index={index} />
            <div className="catalog-card-action border-t border-[var(--color-border)] pt-3 mt-auto">
              <Skeleton width="25%" height="1rem" radius={1} index={index} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
