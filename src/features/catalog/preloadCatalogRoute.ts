import { loadCatalogRoute } from './loadCatalogRoute'

interface ConnectionNavigator extends Navigator {
  connection?: {
    saveData?: boolean
  }
}

interface CatalogRoutePreloadOptions {
  hash?: string
  loadRoute?: typeof loadCatalogRoute
  navigatorValue?: ConnectionNavigator
}

export function isCatalogRootHash(hash: string): boolean {
  const route = (hash.startsWith('#') ? hash.slice(1) : hash).split('?', 1)[0]
  return route === '' || route === '/'
}

export function preloadInitialCatalogRoute({
  hash = window.location.hash,
  loadRoute = loadCatalogRoute,
  navigatorValue = navigator as ConnectionNavigator,
}: CatalogRoutePreloadOptions = {}): void {
  if (!isCatalogRootHash(hash) || navigatorValue.connection?.saveData === true) {
    return
  }

  void loadRoute().catch(() => undefined)
}
