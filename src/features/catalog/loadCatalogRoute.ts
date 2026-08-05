import { createRetryableRouteLoader } from '../../shared/routing/createRetryableRouteLoader'

export const loadCatalogRoute = createRetryableRouteLoader(() => import('./CatalogPage'))
