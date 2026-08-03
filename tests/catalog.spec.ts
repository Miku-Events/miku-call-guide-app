import { expect, test } from './fixtures/app-test'
import { rootManifest } from './fixtures/data'
import { expectLocatorMinTouchTarget, expectPageContained } from './fixtures/geometry'

interface CatalogRequestCounts {
  childManifest: number
  rootManifest: number
  song: number
}

function watchCatalogRequests(page: import('@playwright/test').Page): CatalogRequestCounts {
  const requests: CatalogRequestCounts = {
    childManifest: 0,
    rootManifest: 0,
    song: 0,
  }

  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.endsWith('/call-guide-manifest.json')) {
      requests.childManifest += 1
    } else if (pathname.endsWith('/manifest.json')) {
      requests.rootManifest += 1
    } else if (pathname.endsWith('/songs/future-light-sample.json')) {
      requests.song += 1
    }
  })

  return requests
}

test('renders the catalog navigation, filters, and practice cards', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1')

  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Catalog' }).first()).toHaveAttribute('data-active', 'true')
  await expect(page.getByRole('link', { name: 'Events' }).first()).toHaveAttribute('data-active', 'false')
  await expect(page.getByRole('button', { name: /Reload/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '전체' })).toHaveAttribute('data-active', 'true')

  const songCard = page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })
  await expect(songCard).toBeVisible()
  await expect(songCard).toContainText('하츠네 미쿠 팬 샘플')
  await expect(songCard).toContainText('Practice')
  await expect(songCard).not.toContainText('published')
  await expect(songCard).not.toContainText('M7lc1UVf-VE')
  await expect(songCard).not.toContainText('iAU1LmhtCSw')

  const thumbnail = songCard.locator('.catalog-song-thumbnail')
  await expect(thumbnail).toHaveAttribute('src', 'https://i.ytimg.com/vi/iAU1LmhtCSw/hqdefault.jpg')
  await expect(thumbnail).toHaveAttribute('alt', '')
  await expect(thumbnail).toHaveAttribute('aria-hidden', 'true')
  await expect(thumbnail).toHaveAttribute('loading', 'lazy')
})

test('keeps the catalog usable and contained on a touch viewport', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1')

  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
  const allFilter = page.getByRole('button', { name: '전체' })
  const songCard = page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })
  await expect(allFilter).toHaveAttribute('data-active', 'true')
  await expect(songCard).toBeVisible()
  await expectLocatorMinTouchTarget(allFilter)
  await expectLocatorMinTouchTarget(songCard)
  await expectPageContained(page)
})

test('shows catalog retry only when the initial manifest request fails', { tag: '@desktop' }, async ({ page }) => {
  await page.unroute('**/manifest.json')
  let shouldFail = true
  await page.route('**/manifest.json', async (route) => {
    if (shouldFail) {
      await route.fulfill({ status: 500, body: 'manifest unavailable' })
      return
    }

    await route.fulfill({ json: rootManifest })
  })

  await page.goto('/?mockPlayer=1')

  await expect(page.getByRole('alert')).toContainText('Request failed with 500.')
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Reload/ })).toHaveCount(0)

  shouldFail = false
  await page.getByRole('button', { name: '다시 시도' }).click()

  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
  await expect(page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })).toBeVisible()
})

test('shows catalog retry when cached manifest data is being used', { tag: '@desktop' }, async ({ page }) => {
  await page.unroute('**/manifest.json')
  let shouldFail = false
  await page.route('**/manifest.json', async (route) => {
    if (shouldFail) {
      await route.fulfill({ status: 500, body: 'manifest unavailable' })
      return
    }

    await route.fulfill({ json: rootManifest })
  })

  await page.goto('/?mockPlayer=1')
  await expect(page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })).toBeVisible()

  shouldFail = true
  await page.reload()

  await expect(page.locator('.app-status-banner')).toContainText('캐시를 사용 중입니다.')
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible()
  await expect(page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })).toBeVisible()

  shouldFail = false
  await page.getByRole('button', { name: '다시 시도' }).click()

  await expect(page.locator('.app-status-banner')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
})

test('shares hover-prefetched data with desktop practice navigation', { tag: '@desktop' }, async ({ page }) => {
  const requests = watchCatalogRequests(page)

  await page.goto('/?mockPlayer=1')
  const songCard = page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })
  await expect(songCard).toBeVisible()
  await expect.poll(() => requests.rootManifest).toBe(1)
  await expect.poll(() => requests.childManifest).toBe(1)

  await songCard.hover()
  await expect.poll(() => requests.song).toBe(1)
  await songCard.click()

  await expect(page.getByRole('heading', { name: '퓨처 라이트 샘플' })).toBeVisible()
  expect(requests.rootManifest).toBe(1)
  expect(requests.childManifest).toBe(1)
  expect(requests.song).toBe(1)
})

test('shares pointer-down-prefetched data with touch practice navigation', { tag: '@mobile' }, async ({ page }) => {
  const requests = watchCatalogRequests(page)

  await page.goto('/?mockPlayer=1')
  const songCard = page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })
  await expect(songCard).toBeVisible()
  await expect.poll(() => requests.rootManifest).toBe(1)
  await expect.poll(() => requests.childManifest).toBe(1)

  await songCard.tap()

  await expect(page.getByRole('heading', { name: '퓨처 라이트 샘플' })).toBeVisible()
  await expect.poll(() => requests.song).toBe(1)
  expect(requests.rootManifest).toBe(1)
  expect(requests.childManifest).toBe(1)
})
