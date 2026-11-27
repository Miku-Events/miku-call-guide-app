/* eslint-disable react-refresh/only-export-components, @typescript-eslint/no-explicit-any */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Link } from 'react-router'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { LinkProvider } from '@astryxdesign/core/Link'
import { HashRouterSkipLinkGuard } from './shared/layout/HashRouterSkipLinkGuard'
import { preloadInitialCatalogRoute } from './features/catalog/preloadCatalogRoute'
import './index.css'
import App from './App.tsx'

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
  // The interface is designed dark-only: a stage-like surface for practising with video.
  return (
    <Theme theme={neutralTheme} mode="dark">
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
