import type { Page } from '@playwright/test'
import { expect, setMockedSong, test } from './fixtures/app-test'
import {
  attakaitoWrappedEndAnchorSong,
  autoFollowSong,
  crossLaneAnchorRailSong,
  endAnchorSong,
  explicitCountdownSong,
  leftAnchorSong,
  longIntroCountdownSong,
  longLyricSong,
  overlappingKindSong,
  ppphLeftAnchorSong,
  segmentedSong,
  separatedInactivePreviewSong,
  shortIntro180MsSong,
  shortIntro60MsSong,
  spaceAnchorSong,
  wordWrapSong,
  wrappedRangeSong,
} from './fixtures/data'

async function setMockPlaybackTime(page: Page, timeMs: number): Promise<void> {
  const slider = page.getByRole('slider', { name: '재생 위치' })
  await slider.fill(String(timeMs))
  await expect(slider).toHaveValue(String(timeMs))
}

test('shows an automatic 3-2-1 countdown for a long intro and removes it at the first lyric', async ({ page }) => {
  setMockedSong(page, longIntroCountdownSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const countdown = page.getByRole('timer')

  await expect(countdown).toHaveCount(0)

  await setMockPlaybackTime(page, 3000)
  await expect(countdown).toHaveAttribute('aria-label', '카운트다운 3')
  await expect(countdown).toHaveText('3')

  const layout = await countdown.evaluate((element) => {
    const countdownRect = element.getBoundingClientRect()
    const shellRect = element.closest('.lyric-list-shell')?.getBoundingClientRect()

    return shellRect
      ? {
          bottom: countdownRect.bottom,
          left: countdownRect.left,
          pointerEvents: getComputedStyle(element).pointerEvents,
          right: countdownRect.right,
          shellBottom: shellRect.bottom,
          shellLeft: shellRect.left,
          shellRight: shellRect.right,
          shellTop: shellRect.top,
          top: countdownRect.top,
        }
      : null
  })

  expect(layout).not.toBeNull()
  expect(layout!.pointerEvents).toBe('none')
  expect(layout!.left).toBeGreaterThanOrEqual(layout!.shellLeft - 1)
  expect(layout!.right).toBeLessThanOrEqual(layout!.shellRight + 1)
  expect(layout!.top).toBeGreaterThanOrEqual(layout!.shellTop - 1)
  expect(layout!.bottom).toBeLessThanOrEqual(layout!.shellBottom + 1)

  await setMockPlaybackTime(page, 4000)
  await expect(countdown).toHaveAttribute('aria-label', '카운트다운 2')
  await expect(countdown).toHaveText('2')

  await setMockPlaybackTime(page, 5000)
  await expect(countdown).toHaveAttribute('aria-label', '카운트다운 1')
  await expect(countdown).toHaveText('1')

  await setMockPlaybackTime(page, 6000)
  await expect(countdown).toHaveCount(0)
  await expect(page.locator('.lyric-line[data-position="current"]').getByLabel('光るステージへ')).toBeVisible()
})

test('reduces countdown number motion when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  setMockedSong(page, longIntroCountdownSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await setMockPlaybackTime(page, 3000)

  const countdownNumber = page.locator('.lyric-countdown-number')
  await expect(countdownNumber).toHaveText('3')
  const animationDurationMs = await countdownNumber.evaluate((element) => {
    const duration = getComputedStyle(element).animationDuration
    return duration.endsWith('ms') ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000
  })

  expect(animationDurationMs).toBeLessThanOrEqual(1)
})

for (const [introMs, candidate] of [
  [60, shortIntro60MsSong],
  [180, shortIntro180MsSong],
] as const) {
  test(`does not show a partial countdown for a ${introMs}ms intro`, async ({ page }) => {
    setMockedSong(page, candidate)

    await page.goto('/?mockPlayer=1#/songs/future-light-sample')

    await expect(page.getByRole('timer')).toHaveCount(0)
    await expect(page.getByText('0:00.0').first()).toBeVisible()
  })
}

test('divides an explicit six-second countdown into thirds and restores it after rewinding', async ({ page }) => {
  setMockedSong(page, explicitCountdownSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const countdown = page.locator('.lyric-countdown')

  await setMockPlaybackTime(page, 6000)
  await expect(countdown).toHaveAttribute('aria-label', '카운트다운 3')
  await expect(countdown).toHaveText('3')

  await setMockPlaybackTime(page, 8000)
  await expect(countdown).toHaveAttribute('aria-label', '카운트다운 2')
  await expect(countdown).toHaveText('2')

  await setMockPlaybackTime(page, 10000)
  await expect(countdown).toHaveAttribute('aria-label', '카운트다운 1')
  await expect(countdown).toHaveText('1')

  await setMockPlaybackTime(page, 12000)
  await expect(countdown).toHaveCount(0)

  await setMockPlaybackTime(page, 8000)
  await expect(countdown).toHaveAttribute('aria-label', '카운트다운 2')
  await expect(countdown).toHaveText('2')
})

test('seeks to a countdown start when its end matches the clicked lyric start', async ({ page }) => {
  setMockedSong(page, explicitCountdownSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await page.getByRole('button', { name: /声を重ねよう/ }).click()

  await expect(page.getByText('0:06.0').first()).toBeVisible()
  await expect(page.getByRole('timer', { name: '카운트다운 3' })).toBeVisible()
})

test('renders the mock player and places an above call marker over the lyric line', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await expect(page.getByRole('heading', { name: '퓨처 라이트 샘플' })).toBeVisible()
  await expect(page.getByTestId('mock-player')).toBeVisible()
  await expect(page.locator('.lyric-original:not(.lyric-original-measure)', { hasText: '光るステージへ' })).toBeVisible()
  await expect(page.getByText('하이! 하이!')).toBeVisible()
  await expect(page.locator('.call-marker[data-variant="preview"]', { hasText: '오-!' })).toBeVisible()
  await expect(page.locator('.call-range-end-arrow')).toBeVisible()

  const callBox = await page.locator('.call-marker-text', { hasText: '하이! 하이!' }).boundingBox()
  const lyricBox = await page.locator('.lyric-original[aria-label="光るステージへ"]').boundingBox()
  expect(callBox).not.toBeNull()
  expect(lyricBox).not.toBeNull()
  expect(callBox!.y).toBeLessThan(lyricBox!.y)

  const videoBox = await page.locator('.video-frame').boundingBox()
  const lyricListBox = await page.locator('.lyric-list').boundingBox()
  expect(videoBox).not.toBeNull()
  expect(lyricListBox).not.toBeNull()
  expect(videoBox!.height).toBeGreaterThan(120)
  expect(lyricListBox!.height).toBeGreaterThan(120)

  const palette = await page.evaluate(() => {
    const shell = document.querySelector('.player-shell')
    const topBar = document.querySelector('.player-top-bar')
    const lyricsPanel = document.querySelector('.live-lyrics-panel')

    return shell && topBar && lyricsPanel
      ? {
          shellBackground: getComputedStyle(shell).backgroundColor,
          shellImage: getComputedStyle(shell).backgroundImage,
          topBarBackground: getComputedStyle(topBar).backgroundColor,
          lyricsBackground: getComputedStyle(lyricsPanel).backgroundColor,
        }
      : null
  })

  expect(palette).not.toBeNull()
  expect(palette!.shellBackground).toBe('rgb(9, 9, 11)')
  expect(palette!.shellImage).not.toContain('0, 146, 155')
  expect(palette!.shellImage).not.toContain('4, 26, 28')
  expect(palette!.topBarBackground).toBe('rgba(9, 9, 11, 0.92)')
  expect(['rgba(17, 17, 19, 0.88)', 'rgb(9, 9, 11)', 'rgba(0, 0, 0, 0)']).toContain(palette!.lyricsBackground)
})

test('renders a compact legend for the call kinds used in the song', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  const legend = page.locator('.call-kind-legend')
  await expect(legend).toBeVisible()
  await expect(legend.locator('.call-kind-legend-item[data-kind="chant"]')).toHaveText('Voice')
  await expect(legend.locator('.call-kind-legend-item[data-kind="penlight"]')).toHaveText('Penlight')
  await expect(legend.locator('.call-kind-legend-item[data-kind="custom"]')).toHaveCount(0)
})

test('moves the active lyric into the current position as playback advances', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await expect(page.getByText('하이! 하이!')).toBeVisible()
  await page.getByRole('button', { name: '+6s' }).click()

  const activeLyric = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLyric.getByLabel('声を重ねよう')).toBeVisible()
  await expect(activeLyric.locator('.call-marker', { hasText: '오-!' })).toBeVisible()
  await expect(page.locator('.call-marker[data-variant="preview"]', { hasText: '하이! 하이!' })).toBeVisible()
})

test('stacks overlapping call kinds as separate colored marker rows', async ({ page }) => {
  setMockedSong(page, overlappingKindSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  const activeLine = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLine.locator('.call-marker[data-kind="chant"]', { hasText: '하이!' })).toBeVisible()
  await expect(activeLine.locator('.call-marker[data-kind="penlight"]', { hasText: '펜라이트!' })).toBeVisible()

  const metrics = await activeLine.evaluate((line) => {
    const markers = Array.from(line.querySelectorAll<HTMLElement>('.call-marker[data-variant="active"]')).map((marker) => {
      const rect = marker.getBoundingClientRect()
      const chip = marker.querySelector<HTMLElement>('.call-marker-text')
      return {
        kind: marker.dataset.kind,
        top: rect.top,
        background: chip ? getComputedStyle(chip).backgroundColor : '',
      }
    })

    return markers
  })

  expect(metrics.map((marker) => marker.kind)).toEqual(['chant', 'penlight'])
  expect(metrics[0].top).not.toBe(metrics[1].top)
  expect(metrics[0].background).not.toBe(metrics[1].background)
})

test('keeps cross-lane call anchor rails from covering lyrics or pronunciation', async ({ page }) => {
  setMockedSong(page, crossLaneAnchorRailSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  const activeLine = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLine.getByLabel('Wo woo woo')).toBeVisible()
  await expect(activeLine.locator('.call-marker[data-kind="chant"][data-lane="above"]', { hasText: '워 우우 우우' })).toBeVisible()
  await expect(activeLine.locator('.call-marker[data-kind="penlight"][data-lane="below"]', { hasText: '오른손->왼손->O->흔들기' })).toBeVisible()

  const metrics = await activeLine.evaluate((line) => {
    const lyric = line.querySelector<HTMLElement>('.lyric-original')
    const pronunciation = line.querySelector<HTMLElement>('.lyric-pronunciation')
    const blockers = Array.from(line.querySelectorAll<HTMLElement>('.call-marker-text, .call-range, .call-range-end-arrow'))

    const intersects = (a: DOMRect, b: DOMRect, clearance = 0) =>
      a.left < b.right - clearance &&
      a.right > b.left + clearance &&
      a.top < b.bottom - clearance &&
      a.bottom > b.top + clearance

    const lyricRect = lyric?.getBoundingClientRect()
    const pronunciationRect = pronunciation?.getBoundingClientRect()
    const blockerRects = blockers.map((element) => ({
      className: element.className,
      text: element.textContent,
      kind: element.dataset.kind,
      lane: element.dataset.lane,
      rect: element.getBoundingClientRect(),
    }))

    return lyricRect && pronunciationRect
      ? {
          lyricBlocked: blockerRects.filter((item) => intersects(item.rect, lyricRect, 2)),
          pronunciationBlocked: blockerRects.filter((item) => intersects(item.rect, pronunciationRect, 2)),
          overflowing: blockerRects.filter((item) => {
            const panelRect = line.closest('.live-lyrics-panel')?.getBoundingClientRect()
            return panelRect ? item.rect.left < panelRect.left - 1 || item.rect.right > panelRect.right + 1 : false
          }),
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.lyricBlocked).toEqual([])
  expect(metrics!.pronunciationBlocked).toEqual([])
  expect(metrics!.overflowing).toEqual([])
})

test('seeks the mock player when a lyric line is clicked', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await page.getByRole('button', { name: /声を重ねよう/ }).click()

  await expect(page.getByText('0:06.0').first()).toBeVisible()
  await expect(page.locator('.lyric-line[data-position="current"]').getByLabel('声を重ねよう')).toBeVisible()
})

test('shows and clears the current lyric follow button after manual lyric scrolling', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await page.locator('.lyric-list').hover()
  await page.mouse.wheel(0, 120)
  const followButton = page.getByRole('button', { name: '현재 가사' })

  await expect(followButton).toBeVisible()
  await followButton.click()
  await expect(followButton).toHaveCount(0)
})

test('restores lyric follow mode when a lyric line is clicked after manual scrolling', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await page.locator('.lyric-list').hover()
  await page.mouse.wheel(0, 120)
  const followButton = page.getByRole('button', { name: '현재 가사' })

  await expect(followButton).toBeVisible()
  await page.getByRole('button', { name: /声を重ねよう/ }).click()

  await expect(page.getByText('0:06.0').first()).toBeVisible()
  await expect(followButton).toHaveCount(0)
})

test('keeps long active lyrics inside the lyric panel', async ({ page }) => {
  setMockedSong(page, longLyricSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('키라리토 카가야쿠')).toBeVisible()

  const overflowCount = await page.evaluate(() => {
    const panel = document.querySelector('.live-lyrics-panel')?.getBoundingClientRect()
    return Array.from(document.querySelectorAll('.lyric-line, .lyric-original, .lyric-pronunciation, .call-marker-text')).filter((element) => {
      const rect = element.getBoundingClientRect()
      const hasScrollOverflow = element.scrollWidth > element.clientWidth + 1
      const hasRectOverflow = panel ? rect.right > panel.right + 1 : false
      return hasScrollOverflow || hasRectOverflow
    }).length
  })

  expect(overflowCount).toBe(0)
})

test('keeps lyric words from breaking into character-level flex wraps', async ({ page }) => {
  setMockedSong(page, wordWrapSong)
  await page.setViewportSize({ width: 390, height: 820 })

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.locator('.lyric-original:not(.lyric-original-measure)', { hasText: 'METEOR Future Light' })).toBeVisible()

  const metrics = await page.evaluate(() => {
    const lyric = document.querySelector('.lyric-original[aria-label="METEOR Future Light"]')
    const token = Array.from(lyric?.querySelectorAll<HTMLElement>('.lyric-token') ?? []).find((element) =>
      element.textContent?.startsWith('METEOR'),
    )
    const tokenTops = Array.from(token?.querySelectorAll<HTMLElement>('.grapheme') ?? [])
      .filter((element) => element.textContent?.trim())
      .map((element) => Math.round(element.getBoundingClientRect().top))

    return {
      directGraphemeCount: lyric?.querySelectorAll(':scope > .grapheme').length ?? -1,
      tokenCount: lyric?.querySelectorAll('.lyric-token').length ?? -1,
      uniqueTokenTops: new Set(tokenTops).size,
    }
  })

  expect(metrics.directGraphemeCount).toBe(0)
  expect(metrics.tokenCount).toBeGreaterThan(1)
  expect(metrics.uniqueTokenTops).toBe(1)
})

test('keeps wrapped call range markers out of lyric glyph bounds', async ({ page }) => {
  setMockedSong(page, wrappedRangeSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('하이 세노!')).toBeVisible()
  await expect(page.locator('.call-range-end-arrow')).toBeVisible()

  const overlapCount = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    if (!activeLine) {
      return -1
    }

    const markers = Array.from(activeLine.querySelectorAll('.call-range, .call-range-end-arrow'))
    const graphemes = Array.from(activeLine.querySelectorAll('.grapheme')).filter(
      (grapheme) => grapheme.getBoundingClientRect().height > 1,
    )

    return markers.reduce((count, marker) => {
      const markerRect = marker.getBoundingClientRect()
      const overlapsGlyph = graphemes.some((grapheme) => {
        const glyphRect = grapheme.getBoundingClientRect()
        return (
          markerRect.left < glyphRect.right - 1 &&
          markerRect.right > glyphRect.left + 1 &&
          markerRect.top < glyphRect.bottom - 30 &&
          markerRect.bottom > glyphRect.top + 30
        )
      })

      return count + (overlapsGlyph ? 1 : 0)
    }, 0)
  })

  expect(await page.locator('.call-range').count()).toBeGreaterThan(1)
  expect(overlapCount).toBe(0)
})

test('anchors a pointChar after the final grapheme to the wrapped lyric end', async ({ page }) => {
  setMockedSong(page, endAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('끝점 콜!')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    const arrow = activeLine?.querySelector('.call-arrow')
    const graphemes = Array.from(activeLine?.querySelectorAll('.grapheme') ?? []).filter(
      (grapheme) => grapheme.getBoundingClientRect().height > 1,
    )
    const first = graphemes[0]?.getBoundingClientRect()
    const last = graphemes.at(-1)?.getBoundingClientRect()
    const arrowRect = arrow?.getBoundingClientRect()

    return first && last && arrowRect
      ? {
          firstBottom: first.bottom,
          firstTop: first.top,
          lastRight: last.right,
          lastTop: last.top,
          arrowBottom: arrowRect.bottom,
          arrowCenterX: arrowRect.left + arrowRect.width / 2,
          arrowTop: arrowRect.top,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.lastTop).toBeGreaterThan(metrics!.firstTop + 8)
  expect(Math.abs(metrics!.arrowCenterX - metrics!.lastRight)).toBeLessThan(15)
  expect(metrics!.arrowTop).toBeGreaterThan(metrics!.firstBottom - 4)
  expect(metrics!.arrowBottom).toBeLessThanOrEqual(metrics!.lastTop + 8)
})

test('keeps an attakaito wrapped end anchor on the second visual lyric line', async ({ page }) => {
  setMockedSong(page, attakaitoWrappedEndAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('Hey!')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    const arrow = activeLine?.querySelector('.call-arrow')
    const marker = activeLine?.querySelector('.call-marker-text')
    const graphemes = Array.from(activeLine?.querySelectorAll('.grapheme') ?? [])
      .map((grapheme) => ({ element: grapheme, rect: grapheme.getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 1)
    const first = graphemes[0]?.rect
    const last = graphemes.at(-1)?.rect
    const arrowRect = arrow?.getBoundingClientRect()
    const markerRect = marker?.getBoundingClientRect()

    return first && last && arrowRect && markerRect
      ? {
          firstBottom: first.bottom,
          firstTop: first.top,
          lastRight: last.right,
          lastTop: last.top,
          arrowBottom: arrowRect.bottom,
          arrowCenterX: arrowRect.left + arrowRect.width / 2,
          arrowTop: arrowRect.top,
          markerBottom: markerRect.bottom,
          markerCenterX: markerRect.left + markerRect.width / 2,
          markerTop: markerRect.top,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.lastTop).toBeGreaterThan(metrics!.firstTop + 8)
  expect(Math.abs(metrics!.arrowCenterX - metrics!.lastRight)).toBeLessThan(14)
  expect(metrics!.arrowTop).toBeGreaterThan(metrics!.firstBottom - 4)
  expect(metrics!.arrowBottom).toBeLessThanOrEqual(metrics!.lastTop + 8)
  expect(Math.abs(metrics!.markerCenterX - metrics!.arrowCenterX)).toBeLessThan(14)
  expect(metrics!.markerBottom).toBeLessThanOrEqual(metrics!.arrowTop + 2)
  expect(metrics!.markerTop).toBeGreaterThan(metrics!.firstTop - 4)
})

test('keeps a left-anchored call marker inside the lyric lane', async ({ page }) => {
  setMockedSong(page, leftAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('왼쪽에서도 잘리지 않는')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    const lane = activeLine?.querySelector('.call-lane')
    const marker = activeLine?.querySelector('.call-marker-text')
    const laneRect = lane?.getBoundingClientRect()
    const markerRect = marker?.getBoundingClientRect()

    return laneRect && markerRect
      ? {
          laneLeft: laneRect.left,
          laneRight: laneRect.right,
          markerLeft: markerRect.left,
          markerRight: markerRect.right,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.markerLeft).toBeGreaterThanOrEqual(metrics!.laneLeft - 1)
  expect(metrics!.markerRight).toBeLessThanOrEqual(metrics!.laneRight + 1)
})

test('keeps a left-anchored PPPH call chip from clipping its text', async ({ page }) => {
  setMockedSong(page, ppphLeftAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('하이 세노! 하이! 하이! 하이하이하이하이!')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    const lane = activeLine?.querySelector('.call-lane')
    const markerText = activeLine?.querySelector<HTMLElement>('.call-marker-text')
    const laneRect = lane?.getBoundingClientRect()
    const markerTextRect = markerText?.getBoundingClientRect()

    return laneRect && markerText && markerTextRect
      ? {
          laneLeft: laneRect.left,
          laneRight: laneRect.right,
          markerLeft: markerTextRect.left,
          markerRight: markerTextRect.right,
          scrollWidth: markerText.scrollWidth,
          clientWidth: markerText.clientWidth,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.markerLeft).toBeGreaterThanOrEqual(metrics!.laneLeft - 1)
  expect(metrics!.markerRight).toBeLessThanOrEqual(metrics!.laneRight + 1)
  expect(metrics!.scrollWidth).toBeLessThanOrEqual(metrics!.clientWidth + 1)
})

test('places inactive call chips at their lyric anchor instead of a leading row', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await expect(page.locator('.call-preview-chip')).toHaveCount(0)
  const inactiveLine = page.locator('.lyric-line', {
    has: page.locator('.lyric-original[aria-label="声を重ねよう"]'),
  })
  await expect(inactiveLine.locator('.call-marker[data-variant="preview"]', { hasText: '오-!' })).toBeVisible()

  const metrics = await page.evaluate(() => {
    const inactiveLine = Array.from(document.querySelectorAll('.lyric-line')).find(
      (line) => line.querySelector('.lyric-original')?.getAttribute('aria-label') === '声を重ねよう',
    )
    const marker = inactiveLine?.querySelector('.call-marker[data-variant="preview"]')
    const target = inactiveLine?.querySelector('[data-grapheme-index="4"]')
    const markerRect = marker?.getBoundingClientRect()
    const targetRect = target?.getBoundingClientRect()

    return markerRect && targetRect
      ? {
          markerCenterX: markerRect.left + markerRect.width / 2,
          targetCenterX: targetRect.left + targetRect.width / 2,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(Math.abs(metrics!.markerCenterX - metrics!.targetCenterX)).toBeLessThan(18)
})

test('keeps separated inactive call chips on the same vertical level', async ({ page }) => {
  setMockedSong(page, separatedInactivePreviewSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const inactiveLine = page.locator('.lyric-line', {
    has: page.locator('.lyric-original[aria-label="声を重ねよう"]'),
  })
  await expect(inactiveLine.locator('.call-marker[data-variant="preview"]')).toHaveCount(2)

  const metrics = await inactiveLine.evaluate((line) => {
    const markers = Array.from(line.querySelectorAll('.call-marker[data-variant="preview"]')).map((marker) => {
      const rect = marker.getBoundingClientRect()
      return {
        centerX: rect.left + rect.width / 2,
        top: rect.top,
      }
    })

    return markers
  })

  expect(metrics).toHaveLength(2)
  expect(Math.abs(metrics[0].top - metrics[1].top)).toBeLessThan(2)
  expect(Math.abs(metrics[0].centerX - metrics[1].centerX)).toBeGreaterThan(40)
})

test('keeps a call marker anchored to a space above the lyric glyphs', async ({ page }) => {
  setMockedSong(page, spaceAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.locator('.lyric-original:not(.lyric-original-measure)', { hasText: '嗚呼 日本の魂が' })).toBeVisible()

  const metrics = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    const marker = activeLine?.querySelector('.call-marker')
    const lyric = activeLine?.querySelector('.lyric-original')
    const markerRect = marker?.getBoundingClientRect()
    const lyricRect = lyric?.getBoundingClientRect()

    return markerRect && lyricRect
      ? {
          markerBottom: markerRect.bottom,
          lyricTop: lyricRect.top,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.markerBottom).toBeLessThanOrEqual(metrics!.lyricTop - 2)
})

test('keeps lyric auto-follow from scrolling the page and clipping the video', async ({ page }) => {
  setMockedSong(page, autoFollowSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.locator('.video-frame')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))

  await page.getByRole('button', { name: '+6s' }).click()
  await expect(page.locator('.lyric-line[data-position="current"]').getByLabel('星へ進む三番目')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const topBarRect = document.querySelector('.player-top-bar')?.getBoundingClientRect()
    const videoRect = document.querySelector('.video-frame')?.getBoundingClientRect()

    return topBarRect && videoRect
      ? {
          scrollY: window.scrollY,
          topBarBottom: topBarRect.bottom,
          videoTop: videoRect.top,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.scrollY).toBe(0)
  expect(metrics!.videoTop).toBeGreaterThanOrEqual(metrics!.topBarBottom - 1)
})

test('renders segmented lyricTrack calls as previews and active segment markers', async ({ page }) => {
  setMockedSong(page, segmentedSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await expect(page.locator('.lyric-line[data-position="current"]').getByLabel('光るステージへ')).toBeVisible()
  await expect(page.locator('.lyric-line[data-position="current"]').locator('.call-marker', { hasText: '연속 콜!' })).toBeVisible()
  await expect(page.locator('.call-marker[data-variant="preview"]', { hasText: '연속 콜!' })).toBeVisible()

  await page.getByRole('button', { name: '+6s' }).click()

  const activeLine = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLine.getByLabel('声を重ねよう')).toBeVisible()
  await expect(activeLine.locator('.call-marker', { hasText: '연속 콜!' })).toBeVisible()
  await expect(activeLine.locator('.call-range-end-arrow')).toBeVisible()
  await expect(activeLine.locator('.call-arrow')).toHaveCount(0)
  await expect(page.locator('.call-marker[data-variant="preview"]', { hasText: '연속 콜!' })).toBeVisible()
})
