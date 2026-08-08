import type { Page } from '@playwright/test'
import { expect, setMockedSong, test } from './fixtures/app-test'
import {
  expectAllMarkerGeometryReady,
  expectBrowserRootScrollReady,
  expectLocatorCentered,
  expectLocatorContained,
  expectLocatorContainedInVisualViewport,
  expectLocatorMinTouchTarget,
  expectLocatorNoHorizontalOverflow,
  expectLocatorScrollSettled,
  expectLocatorsNotToOverlap,
  expectMarkerGeometryReady,
  expectPageContained,
  expectPageScrollY,
  swipeLocatorUp,
  wheelPageFromLocator,
  wheelLocatorBy,
} from './fixtures/geometry'
import {
  autoFollowSong,
  crossLaneAnchorRailSong,
  explicitCountdownSong,
  longIntroCountdownSong,
  longLyricSong,
  ppphLeftAnchorSong,
  progressiveDetailSong,
  segmentedSong,
  wrappedRangeSong,
} from './fixtures/data'

async function setMockPlaybackTime(page: Page, timeMs: number): Promise<void> {
  const slider = page.getByRole('slider', { name: '재생 위치' })
  await slider.fill(String(timeMs))
  await expect(slider).toHaveValue(String(timeMs))
}

test('[PLY-D-01] runs the automatic countdown into the first lyric', { tag: '@desktop' }, async ({ page }) => {
  setMockedSong(page, longIntroCountdownSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const countdown = page.getByRole('timer')

  await expect(countdown).toHaveCount(0)
  for (const [timeMs, digit] of [[3000, 3], [4000, 2], [5000, 1]] as const) {
    await setMockPlaybackTime(page, timeMs)
    await expect(countdown).toHaveAttribute('aria-label', `카운트다운 ${digit}`)
    await expect(countdown).toHaveText(String(digit))
  }

  await setMockPlaybackTime(page, 6000)
  await expect(countdown).toHaveCount(0)
  await expect(page.locator('.lyric-line[data-position="current"]')).toContainText('光るステージへ')
})

test('[PLY-D-02] honors reduced motion while preserving countdown semantics', { tag: '@desktop' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  setMockedSong(page, longIntroCountdownSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await setMockPlaybackTime(page, 3000)

  const countdownNumber = page.locator('.lyric-countdown-number')
  await expect(countdownNumber).toHaveText('3')
  await expect.poll(
    () => countdownNumber.evaluate((element) => element.getAnimations().every((animation) => animation.playState !== 'running')),
    { message: 'expected reduced-motion countdown animation to finish immediately' },
  ).toBe(true)
})

test('[PLY-D-03] seeks through the countdown cue when a lyric is activated', { tag: '@desktop' }, async ({ page }) => {
  setMockedSong(page, explicitCountdownSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await page.getByRole('button', { name: /声を重ねよう/ }).click()

  await expect(page.getByText('0:06.0').first()).toBeVisible()
  await expect(page.getByRole('timer', { name: '카운트다운 3' })).toBeVisible()
  await setMockPlaybackTime(page, 12000)
  await expect(page.locator('.lyric-line[data-position="current"]')).toContainText('声を重ねよう')
})

test('[PLY-D-04] moves the active lyric and call semantics as playback advances', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  const firstLine = page.locator('.lyric-line[data-position="current"]')
  await expectMarkerGeometryReady(firstLine.locator('.call-marker[data-variant="active"]', { hasText: '하이! 하이!' }))
  await page.getByRole('button', { name: '+6s' }).click()

  const activeLine = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLine).toContainText('声を重ねよう')
  await expectMarkerGeometryReady(activeLine.locator('.call-marker[data-variant="active"]', { hasText: '오-!' }))
  await expectMarkerGeometryReady(
    page.locator('.call-marker[data-variant="preview"]', { hasText: '하이! 하이!' }),
  )
})

test('[PLY-D-05] restores lyric following with both the follow control and lyric activation', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  const list = page.locator('.lyric-list')
  const followButton = page.getByRole('button', { name: '현재 가사' })
  await wheelLocatorBy(list, 120)
  await expect(followButton).toBeVisible()
  await followButton.click()
  await expect(followButton).toHaveCount(0)

  await wheelLocatorBy(list, 120)
  await expect(followButton).toBeVisible()
  await page.getByRole('button', { name: /声を重ねよう/ }).click()
  await expect(page.getByText('0:06.0').first()).toBeVisible()
  await expect(page.locator('.lyric-line[data-position="current"]')).toContainText('声を重ねよう')
  await expect(followButton).toHaveCount(0)
})

test('[PLY-D-06] renders a wrapped call range with accessible active marker semantics', { tag: '@desktop' }, async ({ page }) => {
  setMockedSong(page, wrappedRangeSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const activeLine = page.locator('.lyric-line[data-position="current"]')
  const marker = activeLine.locator('.call-marker[data-variant="active"]', { hasText: '하이 세노!' })
  await expectMarkerGeometryReady(marker)
  await expect(activeLine.locator('.call-range')).toHaveCount(2)
  await expect(activeLine.locator('.call-range-end-arrow')).toBeVisible()
})

test('[PLY-D-07] keeps the measured PPPH call readable inside the player panel', { tag: '@desktop' }, async ({ page }) => {
  setMockedSong(page, ppphLeftAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const marker = page.locator('.call-marker', { hasText: '하이 세노! 하이! 하이! 하이하이하이하이!' })
  await expectMarkerGeometryReady(marker)
  await expectLocatorContained(page.locator('.live-lyrics-panel'), marker.locator('.call-marker-text'))
  await expectLocatorNoHorizontalOverflow(marker.locator('.call-marker-text'))
})

test('[PLY-D-08] keeps 100 lyric shells keyboard-seekable while detail follows the viewport', { tag: '@desktop' }, async ({ page }) => {
  setMockedSong(page, progressiveDetailSong)
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const list = page.locator('.lyric-list')
  const lines = list.locator('.lyric-line')
  const detailedLines = list.locator('.lyric-line[data-detailed="true"]')

  await expect(lines).toHaveCount(100)
  await expect.poll(() => lines.evaluateAll((elements) => elements.every((element) => (element as HTMLElement).tabIndex === 0))).toBe(true)
  await expect.poll(() => detailedLines.count()).toBeGreaterThan(0)
  expect(await detailedLines.count()).toBeLessThan(50)

  await lines.nth(70).scrollIntoViewIfNeeded()
  await expect.poll(() => detailedLines.count()).toBeGreaterThan(0)
  const distantLine = lines.nth(89)
  await distantLine.focus()
  await expect(distantLine).toBeFocused()
  await distantLine.press('Enter')

  const currentLine = list.locator('.lyric-line[data-position="current"]')
  await expect(currentLine).toContainText('090')
  await expect(distantLine).toBeFocused()
  await expectLocatorCentered(list, currentLine)
  await expect(page.getByRole('button', { name: '현재 가사' })).toHaveCount(0)
  expect(await detailedLines.count()).toBeLessThan(50)
})

test('[PLY-D-09] switches segmented lyricTrack calls from preview to active semantics', { tag: '@desktop' }, async ({ page }) => {
  setMockedSong(page, segmentedSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  let activeLine = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLine).toContainText('光るステージへ')
  await expectMarkerGeometryReady(activeLine.locator('.call-marker', { hasText: '연속 콜!' }))
  await expect(page.locator('.call-marker[data-variant="preview"]', { hasText: '연속 콜!' })).toBeVisible()

  await page.getByRole('button', { name: '+6s' }).click()
  activeLine = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLine).toContainText('声を重ねよう')
  await expectMarkerGeometryReady(activeLine.locator('.call-marker', { hasText: '연속 콜!' }))
  await expect(activeLine.locator('.call-range-end-arrow')).toBeVisible()
  await expect(activeLine.locator('.call-arrow')).toHaveCount(0)
})

test('[PLY-M-01] contains the mobile player, video, lyrics, and touch controls', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await expect(page.getByRole('heading', { name: '퓨처 라이트 샘플' })).toBeVisible()
  await expect(page.getByTestId('mock-player')).toBeVisible()
  const activeLine = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLine).toContainText('光るステージへ')
  await expectAllMarkerGeometryReady(activeLine)
  await expectPageContained(page)
  await expectLocatorContained(page.locator('.live-lyrics-panel'), page.locator('.lyric-list-shell'))
  await expectLocatorMinTouchTarget(page.getByRole('button', { name: /声を重ねよう/ }))

  const header = page.locator('.player-top-bar')
  const visibleNavigation = header.locator('nav a:visible')
  const headerAction = header.locator('.app-top-bar-action')
  await expectLocatorContained(header, visibleNavigation.or(header.locator('.player-clock')))
  await expectLocatorsNotToOverlap(visibleNavigation, headerAction)

  await expect(page.locator('.browser-chrome-drag-handle')).toHaveCount(0)
  const browserChromePanSurface = page.locator('.player-title-block')
  await expect(browserChromePanSurface).toBeVisible()
  await expectBrowserRootScrollReady(page, browserChromePanSurface)

  // Headless browsers have no address bar; native wheel scrolling verifies the
  // same root-scroll path that a trusted pan gesture uses on a real device.
  await wheelPageFromLocator(browserChromePanSurface, 160)
  await expectLocatorContainedInVisualViewport(
    page,
    page.locator('.call-guide-sticky-frame, .player-shell, .live-lyrics-panel'),
  )

  await page.getByRole('link', { name: 'Catalog' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
  await expectBrowserRootScrollReady(page, page.locator('.catalog-content-panel'))
  await expectPageScrollY(page, 0)
})

test('[PLY-M-02] keeps cross-lane markers clear of mobile lyrics and pronunciation', { tag: '@mobile' }, async ({ page }) => {
  setMockedSong(page, crossLaneAnchorRailSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const panel = page.locator('.live-lyrics-panel')
  const activeLine = page.locator('.lyric-line[data-position="current"]')
  const markers = activeLine.locator('.call-marker-text, .call-range, .call-range-end-arrow')
  const lyric = activeLine.locator('.lyric-original:not(.lyric-original-measure)')
  const pronunciation = activeLine.locator('.lyric-pronunciation')

  await expect(activeLine).toContainText('Wo woo woo')
  await expectAllMarkerGeometryReady(activeLine, 2)
  await expectLocatorContained(panel, markers)
  await expectLocatorsNotToOverlap(markers, lyric, 2)
  await expectLocatorsNotToOverlap(markers, pronunciation, 2)
  await expectPageContained(page)
})

test('[PLY-M-03] keeps long active lyrics readable inside the mobile lyric panel', { tag: '@mobile' }, async ({ page }) => {
  setMockedSong(page, longLyricSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const panel = page.locator('.live-lyrics-panel')
  const activeLine = page.locator('.lyric-line[data-position="current"]')
  const content = activeLine.locator('.lyric-original, .lyric-pronunciation, .call-marker-text')

  await expect(activeLine.locator('.lyric-pronunciation')).toContainText('키라리토 카가야쿠')
  await expectAllMarkerGeometryReady(activeLine)
  await expectLocatorContained(panel, content)
  await expectLocatorNoHorizontalOverflow(content)
  await expectPageContained(page)
})

test('[PLY-M-04] restores touch auto-follow without scrolling or clipping the mobile page', { tag: '@mobile' }, async ({ page }) => {
  setMockedSong(page, autoFollowSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const list = page.locator('.lyric-list')
  const video = page.locator('.video-frame')
  const followButton = page.getByRole('button', { name: '현재 가사' })

  await expect(video).toBeVisible()
  await swipeLocatorUp(list)
  await expectLocatorScrollSettled(list)
  await expect(followButton).toBeVisible()
  await followButton.tap()
  await expect(followButton).toHaveCount(0)

  await page.getByRole('button', { name: '+6s' }).tap()
  const currentLine = list.locator('.lyric-line[data-position="current"]')
  await expect(currentLine).toContainText('星へ進む三番目')
  await expectLocatorCentered(list, currentLine)
  await expectPageScrollY(page, 0)
  await expectPageContained(page)
  await expectLocatorsNotToOverlap(page.locator('.player-top-bar'), video)
  const viewportBoundPlayer = page.locator(
    '.player-shell, .live-lyrics-panel, .lyric-list-shell, .lyric-list, .lyric-line[data-position="current"]',
  )
  await expectLocatorContainedInVisualViewport(page, viewportBoundPlayer)

  await page.setViewportSize({ width: 412, height: 650 })
  await expectLocatorContainedInVisualViewport(page, viewportBoundPlayer)
})

test('[PLY-M-05] keeps progressive detail bounded through rapid touch scroll and distant activation', { tag: '@mobile' }, async ({ page }) => {
  setMockedSong(page, progressiveDetailSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const list = page.locator('.lyric-list')
  const lines = list.locator('.lyric-line')
  const detailedLines = list.locator('.lyric-line[data-detailed="true"]')

  await expect(lines).toHaveCount(100)
  await expect.poll(() => detailedLines.count()).toBeGreaterThan(0)
  expect(await detailedLines.count()).toBeLessThan(50)
  await swipeLocatorUp(list)
  await expectLocatorScrollSettled(list)
  await swipeLocatorUp(list)
  await expectLocatorScrollSettled(list)

  const distantLine = lines.nth(89)
  await distantLine.scrollIntoViewIfNeeded()
  await distantLine.focus()
  await expect(distantLine).toHaveAttribute('data-detailed', 'true')
  await expectLocatorScrollSettled(list)
  await distantLine.tap()
  await expect(distantLine).toBeFocused()

  const currentLine = list.locator('.lyric-line[data-position="current"]')
  await expect(currentLine).toContainText('090')
  await expectLocatorCentered(list, currentLine)
  expect(await detailedLines.count()).toBeLessThan(50)
  await expectPageContained(page)
})
