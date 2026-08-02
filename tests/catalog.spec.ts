import { expect, test } from './fixtures/app-test'
import { rootManifest } from './fixtures/data'

test('renders the main catalog as a dark responsive practice surface', async ({ page }) => {
  await page.goto('/?mockPlayer=1')

  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Catalog' }).first()).toHaveAttribute('data-active', 'true')
  await expect(page.getByRole('link', { name: 'Events' }).first()).toHaveAttribute('data-active', 'false')
  await expect(page.getByRole('button', { name: /Reload/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '전체' })).toHaveAttribute('data-active', 'true')
  await expect(page.locator('.app-summary-strip')).not.toContainText('Events')
  await expect(page.locator('.app-summary-strip')).not.toContainText('Open')
  const songCard = page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })
  await expect(songCard).toBeVisible()
  await expect(songCard).toContainText('하츠네 미쿠 팬 샘플')
  await expect(songCard).toContainText('Practice')
  await expect(page.locator('.catalog-source-chip')).toHaveCount(0)
  await expect(page.locator('.catalog-status-pill')).toHaveCount(0)
  await expect(songCard).not.toContainText('published')
  await expect(songCard).not.toContainText('M7lc1UVf-VE')
  await expect(songCard).not.toContainText('iAU1LmhtCSw')
  const thumbnail = songCard.locator('.catalog-song-thumbnail')
  await expect(thumbnail).toHaveAttribute('src', 'https://i.ytimg.com/vi/iAU1LmhtCSw/hqdefault.jpg')
  await expect(thumbnail).toHaveAttribute('alt', '')
  await expect(thumbnail).toHaveAttribute('aria-hidden', 'true')
  await expect(thumbnail).toHaveAttribute('loading', 'lazy')

  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.catalog-shell')
    const heading = document.querySelector('.app-heading-row')
    const title = document.querySelector('#catalog-page-title')
    const summary = document.querySelector('.app-summary-strip')
    const summaryItem = document.querySelector('.app-summary-item')
    const card = document.querySelector<HTMLElement>('.catalog-song-card')
    const contentPanel = document.querySelector<HTMLElement>('.catalog-content-panel')
    const media = card?.querySelector<HTMLElement>('.catalog-song-media')
    const content = card?.querySelector<HTMLElement>('.catalog-song-content')
    const thumbnail = card?.querySelector<HTMLElement>('.catalog-song-thumbnail')
    const titleInCard = card?.querySelector<HTMLElement>('h2')
    const toolbar = document.querySelector('.app-toolbar')
    const cardStyle = card ? getComputedStyle(card) : null
    const contentPanelStyle = contentPanel ? getComputedStyle(contentPanel) : null
    const contentStyle = content ? getComputedStyle(content) : null
    const mediaRect = media?.getBoundingClientRect()
    const contentRect = content?.getBoundingClientRect()
    const mediaStyle = media ? getComputedStyle(media) : null
    const thumbnailStyle = thumbnail ? getComputedStyle(thumbnail) : null
    const thumbnailTransform = thumbnailStyle?.transform ?? 'none'
    const shellStyle = shell ? getComputedStyle(shell) : null
    const titleRect = title?.getBoundingClientRect()
    const summaryRect = summary?.getBoundingClientRect()
    const summaryItemStyle = summaryItem ? getComputedStyle(summaryItem) : null
    const toolbarRect = toolbar?.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const overflowing = Array.from(
      document.querySelectorAll(
        '.app-top-bar-inner, .app-main, .app-heading-row, .app-summary-strip, .app-toolbar, .catalog-content-panel, .catalog-song-card, .catalog-search, .catalog-segmented',
      ),
    ).filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left < -1 || rect.right > viewportWidth + 1 || element.scrollWidth > element.clientWidth + 1
    }).length

    return {
      background: shellStyle?.backgroundColor,
      cardBackground: cardStyle?.backgroundColor,
      cardHasOriginalArtClass: card?.classList.contains('catalog-song-card--original-art') ?? false,
      cardIsolation: cardStyle?.isolation,
      cardOverflow: cardStyle?.overflow,
      cardPosition: cardStyle?.position,
      contentZIndex: contentStyle?.zIndex,
      colorScheme: shellStyle?.colorScheme,
      contentPanelOverflowY: contentPanelStyle?.overflowY,
      contentBackgroundImage: contentStyle?.backgroundImage,
      mediaContentOverlap: mediaRect && contentRect ? mediaRect.bottom - contentRect.top : 0,
      mediaHeight: mediaRect?.height ?? 0,
      mediaOverflow: mediaStyle?.overflow,
      mediaPosition: mediaStyle?.position,
      overflowing,
      summaryDisplay: summary ? getComputedStyle(summary).display : 'missing',
      summaryBeforeToolbar: summaryRect && toolbarRect ? summaryRect.bottom <= toolbarRect.top : false,
      summaryItemPaddingTop: summaryItemStyle ? Number.parseFloat(summaryItemStyle.paddingTop) : Number.POSITIVE_INFINITY,
      summaryInHeading: summary && heading ? heading.contains(summary) : false,
      summarySharesHeadingLine:
        titleRect && summaryRect ? summaryRect.top < titleRect.bottom && summaryRect.bottom > titleRect.top : false,
      textOverflowing: [titleInCard].filter((element): element is HTMLElement => Boolean(element)).filter(
        (element) => element.scrollWidth > element.clientWidth + 1,
      ).length,
      thumbnailObjectFit: thumbnailStyle?.objectFit,
      thumbnailOpacity: thumbnailStyle ? Number.parseFloat(thumbnailStyle.opacity) : Number.POSITIVE_INFINITY,
      thumbnailPosition: thumbnailStyle?.position,
      thumbnailScale: thumbnailTransform === 'none' ? 1 : new DOMMatrixReadOnly(thumbnailTransform).a,
      viewportWidth,
    }
  })

  expect(metrics.background).toBe('rgb(9, 9, 11)')
  expect(metrics.cardBackground).toBe('rgb(17, 17, 19)')
  expect(metrics.cardHasOriginalArtClass).toBe(true)
  expect(metrics.cardIsolation).toBe('isolate')
  expect(metrics.cardOverflow).toBe('hidden')
  expect(metrics.cardPosition).toBe('relative')
  expect(metrics.contentZIndex).toBe('1')
  expect(metrics.colorScheme).toBe('dark')
  expect(metrics.contentPanelOverflowY).toBe('auto')
  expect(metrics.contentBackgroundImage).toContain('linear-gradient')
  expect(metrics.mediaContentOverlap).toBeGreaterThan(20)
  expect(metrics.mediaContentOverlap).toBeLessThan(52)
  expect(metrics.mediaHeight).toBeGreaterThan(120)
  expect(metrics.mediaOverflow).toBe('hidden')
  expect(metrics.mediaPosition).toBe('relative')
  expect(metrics.overflowing).toBe(0)
  expect(metrics.summaryInHeading).toBe(true)
  expect(metrics.summaryBeforeToolbar).toBe(true)
  expect(metrics.textOverflowing).toBe(0)
  expect(metrics.thumbnailObjectFit).toBe('cover')
  expect(metrics.thumbnailOpacity).toBeGreaterThan(0.75)
  expect(metrics.thumbnailOpacity).toBeLessThanOrEqual(1)
  expect(metrics.thumbnailPosition).toBe('absolute')
  expect(metrics.thumbnailScale).toBeGreaterThan(1.3)
  expect(metrics.thumbnailScale).toBeLessThan(1.45)
  if (metrics.viewportWidth <= 760) {
    expect(metrics.summaryDisplay).toBe('none')
  } else {
    expect(metrics.summarySharesHeadingLine).toBe(true)
    expect(metrics.summaryItemPaddingTop).toBeGreaterThan(4)
  }
})

test('shows catalog retry only when the initial manifest request fails', async ({ page }) => {
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

test('shows catalog retry when cached manifest data is being used', async ({ page }) => {
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

test('shares manifest and prefetched song data when navigating from catalog to practice', async ({ page }) => {
  const requests = {
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
