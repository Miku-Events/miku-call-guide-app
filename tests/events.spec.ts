import { expect, test } from './fixtures/app-test'

async function closeMobileDetail(page: import('@playwright/test').Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 0) <= 980) {
    const closeButton = page.getByRole('button', { name: '상세 닫기' })
    await expect(closeButton).toBeVisible()
    await closeButton.click()
    await expect(page.locator('.event-detail-panel')).toHaveAttribute('data-open', 'false')
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-05-21T12:00:00+09:00'))
})

test('opens the event calendar through date controls and exposes selection state', async ({ page }) => {
  await page.goto('/?mockPlayer=1')
  await page.getByRole('link', { name: 'Events' }).first().click()

  await expect(page).toHaveURL(/#\/events$/)
  await expect(page.getByRole('heading', { name: 'Event Calendar' })).toBeVisible()
  await expect(page.locator('.event-month-controls')).toContainText('2026년 5월')

  const addEventButton = page.getByRole('button', { name: '일정 추가' })
  const addEventBox = await addEventButton.boundingBox()
  expect(addEventBox).not.toBeNull()
  expect(addEventBox!.height).toBeGreaterThanOrEqual(44)
  await expect(addEventButton).toHaveClass(/event-add-compact-button/)
  expect(await addEventButton.evaluate((button) => Boolean(button.closest('.app-toolbar')))).toBe(true)
  expect(await addEventButton.evaluate((button) => Boolean(button.closest('.app-top-bar')))).toBe(false)

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

  const dayBox = await today.boundingBox()
  expect(dayBox).not.toBeNull()
  expect(dayBox!.width).toBeGreaterThanOrEqual(44)
  expect(dayBox!.height).toBeGreaterThanOrEqual(44)

  const isCompact = (page.viewportSize()?.width ?? 0) <= 620
  if (isCompact) {
    await expect(page.locator('.event-span-bars').first()).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('button.event-span-bar')).toHaveCount(0)
  } else {
    expect(await page.locator('button.event-span-bar').count()).toBeGreaterThan(0)
  }

  await today.click()
  await expect(today).toHaveAttribute('aria-pressed', 'true')
  await expect(today).toHaveAttribute('aria-label', /오늘, 선택됨/)
  await expect(page.locator('.event-detail-panel')).toHaveAttribute('data-open', 'true')

  const detailCard = page.locator('.event-detail-card', { hasText: '하츠네 미쿠 다일 팝업 샘플' })
  await expect(detailCard).toBeVisible()
  await expect(detailCard).toContainText('오전 10:00 - 오후 08:00')
  await expect(detailCard.locator('.event-x-embed')).toBeVisible()
})

test('preserves calendar lanes and loads date-only and timed details across months', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/events')
  await expect(page.locator('.event-span-bar').first()).toBeVisible()

  const laneMetrics = await page.evaluate(() => {
    const middle = document.querySelector<HTMLElement>('.event-span-bar[data-occurrence-id="middle-period"]')
    const reuse = document.querySelector<HTMLElement>('.event-span-bar[data-occurrence-id="reuse-day"]')
    const upper = document.querySelector<HTMLElement>('.event-span-bar[data-occurrence-id="upper-period"]')

    return middle && reuse && upper
      ? {
          middleLane: middle.style.getPropertyValue('--event-bar-lane').trim(),
          reuseLane: reuse.style.getPropertyValue('--event-bar-lane').trim(),
          upperLane: upper.style.getPropertyValue('--event-bar-lane').trim(),
          middleTop: middle.getBoundingClientRect().top,
          reuseTop: reuse.getBoundingClientRect().top,
          upperTop: upper.getBoundingClientRect().top,
        }
      : null
  })
  expect(laneMetrics).not.toBeNull()
  expect(laneMetrics!.middleLane).toBe('1')
  expect(laneMetrics!.reuseLane).toBe('1')
  expect(laneMetrics!.upperLane).toBe('2')
  expect(Math.abs(laneMetrics!.middleTop - laneMetrics!.reuseTop)).toBeLessThanOrEqual(1)
  expect(laneMetrics!.reuseTop).toBeLessThan(laneMetrics!.upperTop)

  const mayBarHeights = await page.locator('.event-calendar-panel .event-span-bar').evaluateAll((bars) =>
    bars.map((bar) => bar.getBoundingClientRect().height),
  )
  expect(Math.max(...mayBarHeights) - Math.min(...mayBarHeights)).toBeLessThanOrEqual(1)

  await page.locator('.event-day-cell[data-date="2026-05-21"]').click()
  await expect(page.locator('.event-detail-card', { hasText: '하츠네 미쿠 다일 팝업 샘플' })).toBeVisible()
  await closeMobileDetail(page)

  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.locator('.event-month-controls')).toContainText('2026년 6월')

  await page.locator('.event-day-cell[data-date="2026-06-01"]').click()
  const dateOnlyDetail = page.locator('.event-detail-card', { hasText: '제2회 미쿠감사제: 우리들의 즐거운 시간' })
  await expect(dateOnlyDetail).toBeVisible()
  await expect(dateOnlyDetail.locator('.event-detail-time')).toHaveCount(0)
  await closeMobileDetail(page)

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

for (const width of [320, 375, 620]) {
  test(`keeps the mobile event path touchable and contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await page.goto('/?mockPlayer=1#/events')
    await expect(page.locator('.event-day-cell[data-date="2026-05-21"]')).toBeVisible()

    const targets = page.locator([
      '.event-month-controls button',
      '.event-type-filters button',
      '.event-add-compact-button',
      '.event-day-cell',
    ].join(', '))
    const targetSizes = await targets.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return { height: rect.height, width: rect.width }
      }),
    )

    expect(targetSizes.length).toBeGreaterThan(40)
    expect(targetSizes.filter(({ height, width: targetWidth }) => height < 44 || targetWidth < 44)).toEqual([])
    await expect(page.locator('button.event-span-bar')).toHaveCount(0)

    await page.locator('.event-day-cell[data-date="2026-05-21"]').click()
    await expect(page.locator('.event-detail-card', { hasText: '하츠네 미쿠 다일 팝업 샘플' })).toBeVisible()

    const layout = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.event-calendar-panel')
      const scrollingElement = document.scrollingElement
      return {
        documentOverflowsX: Boolean(scrollingElement && scrollingElement.scrollWidth > scrollingElement.clientWidth + 1),
        panelCanScrollX: Boolean(panel && panel.scrollWidth > panel.clientWidth + 1),
      }
    })
    expect(layout.documentOverflowsX).toBe(false)

    const panel = page.locator('.event-calendar-panel')
    await expect(panel).toHaveAttribute('data-scrollable', layout.panelCanScrollX ? 'true' : 'false')
  })
}
