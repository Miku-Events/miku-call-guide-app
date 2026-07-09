import { AppShell } from '@astryxdesign/core/AppShell'
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'

export function PageShellSkeleton() {
  return (
    <AppShell
      height="fill"
      variant="elevated"
      contentPadding={0}
      className="catalog-shell"
      topNav={
        <TopNav
          label="Main navigation"
          heading={
            <TopNavHeading
              heading="Miku Call Guide"
              logo={<span className="app-brand-mark" aria-hidden="true" />}
              href="/"
            />
          }
          startContent={
            <>
              <span className="opacity-50 px-3 py-1 text-sm font-semibold">Catalog</span>
              <span className="opacity-50 px-3 py-1 text-sm font-semibold">Events</span>
            </>
          }
        />
      }
    >
      <Layout className="app-main">
        <LayoutContent>
          <div className="app-heading-row px-4">
            <div>
              <div className="mb-1.5">
                <Skeleton width={80} height="0.8rem" radius={1} />
              </div>
              <Skeleton width={180} height="2.2rem" radius={1} />
            </div>
            <div className="app-summary-strip flex gap-2">
              <Skeleton width={90} height="1.8rem" radius={2} />
              <Skeleton width={90} height="1.8rem" radius={2} />
            </div>
          </div>

          <div className="app-toolbar flex gap-3 h-11 mx-4 my-2">
            <div className="flex-1 h-full">
              <Skeleton width="100%" height="100%" radius={2} />
            </div>
            <div className="w-44 h-full">
              <Skeleton width="100%" height="100%" radius={2} />
            </div>
          </div>

          <div className="catalog-content-layout mt-6 px-4">
            <div className="catalog-song-grid">
              {Array.from({ length: 6 }).map((_, index) => (
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
          </div>
        </LayoutContent>
      </Layout>
    </AppShell>
  )
}
