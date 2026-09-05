/* eslint-disable react-refresh/only-export-components, @typescript-eslint/no-explicit-any */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Link } from 'react-router'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { LinkProvider } from '@astryxdesign/core/Link'
import { HashRouterSkipLinkGuard } from './shared/layout/HashRouterSkipLinkGuard'
import { initializeCloudflareWebAnalytics } from './shared/analytics/cloudflareWebAnalytics'
import { preloadInitialCatalogRoute } from './features/catalog/preloadCatalogRoute'
import './index.css'
import App from './App.tsx'

initializeCloudflareWebAnalytics({
  document,
  origin: window.location.origin,
  productionRelease: import.meta.env.PROD,
  token: import.meta.env.VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN,
})

preloadInitialCatalogRoute()

// Map Astryx's href prop to React Router's to prop
function RouterLink({ href, ...props }: { href: string; [key: string]: any }) {
  // Check if it's an external link or hash link that should use standard <a> behavior
  if (href.startsWith('http') || href.startsWith('//') || href.startsWith('#')) {
    return <a href={href} {...props} />
  }
  return <Link to={href} {...props} />
}

function Root() {
  // Allow switching theme mode via URL query parameter (e.g. ?mode=light)
  const searchParams = new URLSearchParams(window.location.search || window.location.hash.split('?')[1])
  const urlMode = searchParams.get('mode') || searchParams.get('theme')
  const [mode] = useState<'system' | 'light' | 'dark'>(
    (urlMode === 'light' || urlMode === 'dark' || urlMode === 'system') ? urlMode : 'dark'
  )

  return (
    <Theme theme={neutralTheme} mode={mode}>
      <LinkProvider component={RouterLink as any}>
        <HashRouter>
          <HashRouterSkipLinkGuard>
            <App />
          </HashRouterSkipLinkGuard>
        </HashRouter>
      </LinkProvider>
    </Theme>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
