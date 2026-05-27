import { Link } from 'react-router-dom'

export function PageShellSkeleton() {
  return (
    <main className="app-shell app-page-shell catalog-shell">
      <header className="app-top-bar sticky top-0 z-10">
        <div className="app-top-bar-inner">
          <Link className="app-brand" to="/">
            <span className="app-brand-mark" aria-hidden="true" />
            <span>Miku Call Guide</span>
          </Link>
          <nav className="app-nav" aria-label="Main navigation">
            <span className="opacity-50">Catalog</span>
            <span className="opacity-50">Events</span>
          </nav>
        </div>
      </header>

      <section className="app-main">
        <div className="app-heading-row">
          <div>
            <div className="skeleton skeleton-text" style={{ width: '80px', height: '0.8rem', marginBottom: '0.4rem', borderRadius: '0.25rem' }} />
            <div className="skeleton skeleton-text" style={{ width: '180px', height: '2.2rem', marginBottom: '0.4rem', borderRadius: '0.25rem' }} />
          </div>
          <div className="app-summary-strip">
            <div className="app-summary-item skeleton" style={{ width: '90px', height: '1.8rem', borderRadius: '0.375rem' }} />
            <div className="app-summary-item skeleton" style={{ width: '90px', height: '1.8rem', borderRadius: '0.375rem' }} />
          </div>
        </div>

        <div className="app-toolbar" style={{ display: 'flex', gap: '0.75rem', height: '2.8rem' }}>
          <div className="skeleton" style={{ flex: '1', height: '100%', borderRadius: '0.5rem' }} />
          <div className="skeleton" style={{ width: '180px', height: '100%', borderRadius: '0.5rem' }} />
        </div>

        <div className="catalog-content-layout" style={{ marginTop: '1.5rem' }}>
          <div className="catalog-song-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="catalog-song-card catalog-song-card--skeleton" key={index} aria-hidden="true">
                <div className="catalog-song-media skeleton" style={{ minHeight: '10.25rem' }} />
                <div className="catalog-song-content" style={{ marginTop: '0', background: 'transparent', paddingTop: '1rem' }}>
                  <div className="skeleton" style={{ height: '1.4rem', width: '70%', marginBottom: '0.6rem' }} />
                  <div className="skeleton" style={{ height: '0.9rem', width: '40%', marginBottom: '1.2rem' }} />
                  <div className="skeleton" style={{ height: '2.5rem', width: '100%', marginBottom: '1rem' }} />
                  <div className="catalog-card-action" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.75rem', marginTop: 'auto' }}>
                    <div className="skeleton" style={{ height: '1rem', width: '25%' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
