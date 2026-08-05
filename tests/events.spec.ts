import { expect, test } from './fixtures/app-test'
import { catalogManySongManifest } from './fixtures/data'
import {
  expectLocatorContained,
  expectLocatorMinTouchTarget,
  expectLocatorNoHorizontalOverflow,
  expectPageContained,
} from './fixtures/geometry'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-05-21T12:00:00+09:00'))
})

test('navigates dates, filters, months, and safe event details', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1#/events')

  await expect(page).toHaveURL(/#\/events$/)
  await expect(page.getByRole('heading', { name: 'Event Calendar' })).toBeVisible()
  await expect(page.locator('.event-month-controls')).toContainText('2026년 5월')
  await expect(page.getByRole('button', { name: '일정 추가' })).toBeVisible()

  const allFilter = page.getByRole('button', { name: 'All' })
  const popupFilter = page.getByRole('button', { name: 'Popup' })
  const concertFilter = page.getByRole('button', { name: 'Concert' })
  await expect(allFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(popupFilter).toHaveAttribute('aria-pressed', 'false')
  await expect(concertFilter).toHaveAttribute('aria-pressed', 'false')
  await popupFilter.click()
  await expect(allFilter).toHaveAttribute('aria-pressed', 'false')
  await expect(popupFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.event-span-bar[data-event-type="concert"]')).toHaveCount(0)
  await allFilter.click()

  const today = page.locator('.event-day-cell[data-date="2026-05-21"]')
  await expect(today).toHaveAttribute('aria-current', 'date')
  await expect(today).toHaveAttribute('aria-pressed', 'false')
  await expect(today).toHaveAttribute('aria-label', /2026년 5월 21일 목요일, 오늘/)
  await today.click()
  await expect(today).toHaveAttribute('aria-pressed', 'true')
  await expect(today).toHaveAttribute('aria-label', /오늘, 선택됨/)

  const mayDetail = page.locator('.event-detail-card', { hasText: '하츠네 미쿠 다일 팝업 샘플' })
  await expect(mayDetail).toBeVisible()
  await expect(mayDetail).toContainText('오전 10:00 - 오후 08:00')
  await expect(mayDetail.locator('.event-x-embed')).toBeVisible()

  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.locator('.event-month-controls')).toContainText('2026년 6월')

  await page.locator('.event-day-cell[data-date="2026-06-01"]').click()
  const dateOnlyDetail = page.locator('.event-detail-card', { hasText: '제2회 미쿠감사제: 우리들의 즐거운 시간' })
  await expect(dateOnlyDetail).toBeVisible()
  await expect(dateOnlyDetail.locator('.event-detail-time')).toHaveCount(0)

  await page.locator('.event-day-cell[data-date="2026-06-15"]').click()
  const timedDetail = page.locator('.event-detail-card', { hasText: '하츠네 미쿠 예습 샘플' })
  await expect(timedDetail).toBeVisible()
  await expect(timedDetail.locator('.event-x-embed .twitter-tweet a')).toHaveAttribute(
    'href',
    'https://x.com/example/status/123',
  )
  await expect(timedDetail.locator('.event-link-row').getByRole('link', { name: 'X' })).toHaveAttribute(
    'href',
    'https://x.com/example/status/123',
  )
})

test('supports the event filter and detail journey with touch', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1')
  await page.getByRole('link', { name: 'Events' }).first().tap()

  await expect(page).toHaveURL(/#\/events$/)
  await expect(page.getByRole('heading', { name: 'Event Calendar' })).toBeVisible()
  const popupFilter = page.getByRole('button', { name: 'Popup' })
  await popupFilter.tap()
  await expect(popupFilter).toHaveAttribute('aria-pressed', 'true')

  const today = page.locator('.event-day-cell[data-date="2026-05-21"]')
  await today.tap()
  await expect(today).toHaveAttribute('aria-pressed', 'true')
  const detailCard = page.locator('.event-detail-card', { hasText: '하츠네 미쿠 다일 팝업 샘플' })
  await expect(detailCard).toBeVisible()

  const closeButton = page.getByRole('button', { name: '상세 닫기' })
  await expect(closeButton).toBeVisible()
  await closeButton.tap()
  await expect(detailCard).not.toBeVisible()
})

test('keeps the 320px event path contained with touch-sized controls', { tag: '@mobile' }, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 820 })
  await page.unroute('**/call-guide-manifest.json')
  await page.route('**/call-guide-manifest.json', async (route) => {
    await route.fulfill({ json: catalogManySongManifest })
  })
  await page.goto('/?mockPlayer=1')

  await page.getByRole('button', { name: 'Events' }).tap()
  const catalogPanel = page.locator('.catalog-content-panel')
  const eventGrid = catalogPanel.locator('.catalog-event-grid')
  const eventCards = eventGrid.locator('.catalog-event-folder-card')
  await expect(eventCards).toHaveCount(1)
  await expectLocatorNoHorizontalOverflow(catalogPanel)
  await expectLocatorNoHorizontalOverflow(eventGrid)
  await expectLocatorContained(eventGrid, eventCards)
  await expectLocatorMinTouchTarget(eventCards)
  await expectPageContained(page)

  await page.getByRole('link', { name: 'Events' }).first().tap()
  await expect(page).toHaveURL(/#\/events$/)

  const today = page.locator('.event-day-cell[data-date="2026-05-21"]')
  await expect(today).toBeVisible()
  const targets = [
    page.getByRole('button', { name: 'Previous month' }),
    page.getByRole('button', { name: 'Next month' }),
    page.getByRole('button', { name: 'All' }),
    page.getByRole('button', { name: 'Popup' }),
    page.getByRole('button', { name: '일정 추가' }),
    today,
  ]
  for (const target of targets) {
    await expectLocatorMinTouchTarget(target)
  }

  await today.tap()
  await expect(page.locator('.event-detail-card', { hasText: '하츠네 미쿠 다일 팝업 샘플' })).toBeVisible()
  await expectPageContained(page)
})
