import AxeBuilder from '@axe-core/playwright'
import type { Page, Route } from '@playwright/test'
import { expect, setMockedSession, setMockedSong, test, VERSIONED_LEAF_ROUTES } from './fixtures/app-test'
import { eventCalendarMayMonth, multiDayEventDetail, progressiveDetailSong, song } from './fixtures/data'
import {
  expectLocatorContained,
  expectLocatorMinTouchTarget,
  expectPageContained,
} from './fixtures/geometry'

type TurnstileHarnessWindow = Window & {
  __completeTurnstile: (token?: string) => void
}

async function installTurnstileHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let verify: ((token: string) => void) | null = null

    window.turnstile = {
      render: (_container, options) => {
        verify = options.callback
        return 'e2e-turnstile'
      },
      remove: () => {},
      reset: () => {},
    }

    ;(window as TurnstileHarnessWindow).__completeTurnstile = (token = 'e2e-turnstile-token') => {
      verify?.(token)
    }
  })
}

function seriousOrCriticalViolations(results: Awaited<ReturnType<AxeBuilder['analyze']>>) {
  return results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-05-21T12:00:00+09:00'))
})

test('has no serious automated accessibility violations on catalog and event dialog', { tag: '@both' }, async ({ page }, testInfo) => {
  await page.goto('/?mockPlayer=1')
  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()

  const catalogResults = await new AxeBuilder({ page }).analyze()
  expect(
    seriousOrCriticalViolations(catalogResults),
    JSON.stringify(seriousOrCriticalViolations(catalogResults), null, 2),
  ).toEqual([])

  await page.goto('/?mockPlayer=1#/events')
  await expect(page.locator('.event-day-cell[data-date="2026-05-21"]')).toBeVisible()
  const addEventButton = page.getByRole('button', { name: '일정 추가' })
  if (testInfo.project.name === 'mobile') {
    await addEventButton.tap()
  } else {
    await addEventButton.click()
  }
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.evaluate(async (element) => {
    const animations = element.getAnimations({ subtree: true })
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
  })

  const dialogResults = await new AxeBuilder({ page }).analyze()
  expect(
    seriousOrCriticalViolations(dialogResults),
    JSON.stringify(seriousOrCriticalViolations(dialogResults), null, 2),
  ).toEqual([])
})

test('has no serious automated accessibility violations on the progressive practice list', { tag: '@mobile' }, async ({ page }) => {
  setMockedSong(page, progressiveDetailSong)
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  const list = page.locator('.lyric-list')
  await expect(list.locator('.lyric-line')).toHaveCount(100)
  await expect.poll(() => list.locator('.lyric-line[data-detailed="true"]').count()).toBeGreaterThan(0)
  expect(await list.locator('.lyric-line[data-detailed="false"]').count()).toBeGreaterThan(0)

  const results = await new AxeBuilder({ page }).analyze()
  expect(
    seriousOrCriticalViolations(results),
    JSON.stringify(seriousOrCriticalViolations(results), null, 2),
  ).toEqual([])
})

test('traverses the dialog with Tab and Shift+Tab, closes on Escape, and returns focus', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1#/events')
  const addButton = page.getByRole('button', { name: '일정 추가' })
  await expect(addButton).toBeVisible()
  await addButton.focus()
  await addButton.press('Enter')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  const tabbables = dialog.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
  expect(await tabbables.count()).toBeGreaterThanOrEqual(2)

  const first = tabbables.first()
  const last = tabbables.last()
  await last.focus()
  await page.keyboard.press('Tab')
  await expect(first).toBeFocused()

  await first.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(last).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(addButton).toBeFocused()
})

test('keeps submission errors inside the dialog and announces only success on the page', { tag: '@desktop' }, async ({ page }) => {
  setMockedSession(page, { authenticated: true, login: 'miku-e2e' })
  await installTurnstileHarness(page)

  let submissionAttempts = 0
  await page.route('**/api/events/submissions', async (route) => {
    submissionAttempts += 1
    if (submissionAttempts === 1) {
      await route.fulfill({ json: { error: 'upstream unavailable', requestId: 'e2e-1' }, status: 503 })
      return
    }
    await route.fulfill({ json: { url: 'https://github.com/Miku-Events/miku-call-guide-data/pull/123' } })
  })

  await page.goto('/?mockPlayer=1#/events')
  await page.getByRole('button', { name: '일정 추가' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await page.getByLabel('이벤트 제목').fill('접근성 테스트 이벤트')
  await page.getByLabel('시작일').fill('2026-07-01')
  await page.getByLabel('SNS 링크').fill('https://x.com/example/status/456')
  await page.evaluate(() => {
    ;(window as TurnstileHarnessWindow).__completeTurnstile('first-token')
  })

  const submitButton = page.getByRole('button', { name: 'PR 요청' })
  await expect(submitButton).toBeEnabled()
  await submitButton.click()

  const dialogError = dialog.locator('.event-dialog-error[role="alert"]')
  await expect(dialogError).toContainText('요청을 제출하지 못했습니다.')
  await expect(dialogError).toContainText('보안 검증을 다시 완료한 뒤 재시도해 주세요.')
  const pageSuccessStatus = page.getByRole('status').filter({ hasText: 'PR 생성 요청이 접수되었습니다' })
  await expect(pageSuccessStatus).toHaveCount(0)
  await expect(dialog.getByText('보안 검증을 다시 완료해 주세요.')).toBeVisible()
  await expect(submitButton).toBeDisabled()

  await page.evaluate(() => {
    ;(window as TurnstileHarnessWindow).__completeTurnstile('second-token')
  })
  await expect(submitButton).toBeEnabled()
  await submitButton.click()

  await expect(dialog).not.toBeVisible()
  await expect(pageSuccessStatus).toContainText('PR 생성 요청이 접수되었습니다')
  expect(submissionAttempts).toBe(2)
})

test('announces delayed month and detail loading with aria-busy', { tag: '@desktop' }, async ({ page }) => {
  await page.unroute('**/event-calendar/months/2026-05.json')
  let monthRoute: Route | null = null
  let signalMonthRequest: (() => void) | null = null
  const monthRequested = new Promise<void>((resolve) => {
    signalMonthRequest = resolve
  })
  await page.route('**/event-calendar/months/2026-05.json', (route) => {
    monthRoute = route
    signalMonthRequest?.()
  })

  await page.goto('/?mockPlayer=1#/events')
  await monthRequested
  const calendar = page.locator('.event-calendar-panel')
  await expect(calendar).toHaveAttribute('aria-busy', 'true')
  await expect(calendar.getByRole('status')).toContainText('달력 데이터를 불러오는 중입니다.')
  await (monthRoute as Route | null)?.fulfill({ json: eventCalendarMayMonth })
  await expect(page.locator('.event-day-cell[data-date="2026-05-21"]')).toBeVisible()
  await expect(calendar).toHaveAttribute('aria-busy', 'false')

  await page.unroute(VERSIONED_LEAF_ROUTES.multiDayEvent)
  let detailRoute: Route | null = null
  let signalDetailRequest: (() => void) | null = null
  const detailRequested = new Promise<void>((resolve) => {
    signalDetailRequest = resolve
  })
  await page.route(VERSIONED_LEAF_ROUTES.multiDayEvent, (route) => {
    expect(new URL(route.request().url()).searchParams.get('_miku_data_version')).toBe('e2e')
    detailRoute = route
    signalDetailRequest?.()
  })

  await page.locator('.event-day-cell[data-date="2026-05-21"]').click()
  await detailRequested
  const detailList = page.locator('.event-detail-list')
  await expect(detailList).toHaveAttribute('aria-busy', 'true')
  await expect(detailList.locator('.event-detail-loading-status[role="status"]')).toContainText(
    '상세 정보를 불러오는 중입니다.',
  )
  await (detailRoute as Route | null)?.fulfill({ json: multiDayEventDetail })
  await expect(page.locator('.event-detail-card', { hasText: '하츠네 미쿠 다일 팝업 샘플' })).toBeVisible()
  await expect(detailList).toHaveAttribute('aria-busy', 'false')
})

test('uses the skip link without replacing the HashRouter route', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1#/events')
  await expect(page.getByRole('heading', { name: 'Event Calendar' })).toBeVisible()

  const originalHash = await page.evaluate(() => window.location.hash)
  const skipLink = page.getByTestId('skip-to-content')
  await skipLink.focus()
  await expect(skipLink).toBeVisible()
  await skipLink.click()

  await expect(page.getByRole('heading', { name: 'Event Calendar' })).toBeVisible()
  expect(await page.evaluate(() => window.location.hash)).toBe(originalHash)
  await expect.poll(() => page.getByRole('main').evaluate((main) => main === document.activeElement)).toBe(true)
})

test('recovers from wildcard routes and returns to the catalog', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1#/does-not-exist')
  await expect(page.getByRole('heading', { name: '페이지를 찾을 수 없습니다.' })).toBeVisible()
  await page.getByRole('link', { name: '카탈로그로 돌아가기' }).click()
  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
})

test('retries a failed song request and offers a working catalog recovery path', { tag: '@desktop' }, async ({ page }) => {
  await page.unroute(VERSIONED_LEAF_ROUTES.song)
  let attempts = 0
  await page.route(VERSIONED_LEAF_ROUTES.song, async (route) => {
    expect(new URL(route.request().url()).searchParams.get('_miku_data_version')).toBe('e2e')
    attempts += 1
    if (attempts === 1) {
      await route.fulfill({ body: 'song unavailable', status: 503 })
      return
    }
    await route.fulfill({ json: song })
  })

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByRole('alert')).toContainText('Song request failed with 503.')
  await page.getByRole('button', { name: '다시 시도' }).click()
  await expect(page.getByRole('heading', { name: '퓨처 라이트 샘플' })).toBeVisible()
  expect(attempts).toBe(2)

  await page.goto('/?mockPlayer=1#/songs/not-in-manifest')
  await expect(page.getByRole('alert')).toContainText('was not found in manifest')
  await page.getByRole('link', { name: '카탈로그로 돌아가기' }).click()
  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
})

test('recovers from a YouTube script error and keeps the external fallback available', { tag: '@desktop' }, async ({ page }) => {
  let scriptAttempts = 0
  let releaseFirstScript = () => {}
  const firstScriptGate = new Promise<void>((resolve) => {
    releaseFirstScript = resolve
  })
  await page.route('https://www.youtube.com/iframe_api', async (route) => {
    scriptAttempts += 1
    if (scriptAttempts === 1) {
      await firstScriptGate
      await route.abort('failed')
      return
    }

    await route.fulfill({
      body: `
        window.YT = {
          Player: function (element, options) {
            var iframe = document.createElement('iframe');
            iframe.setAttribute('title', 'Mock YouTube player');
            iframe.setAttribute('width', '640');
            iframe.setAttribute('height', '390');
            element.replaceWith(iframe);
            var player = {
              destroy: function () {},
              getCurrentTime: function () { return 0; },
              seekTo: function () {}
            };
            queueMicrotask(function () {
              if (options.events.onReady) options.events.onReady();
            });
            return player;
          }
        };
      `,
      contentType: 'application/javascript',
    })
  })

  await page.goto('/#/songs/future-light-sample', { waitUntil: 'domcontentloaded' })
  const player = page.getByTestId('youtube-player')
  await expect(player).toHaveAttribute('aria-busy', 'true')
  releaseFirstScript()
  const playerAlert = player.getByRole('alert')
  await expect(playerAlert).toContainText('YouTube 플레이어를 불러오지 못했습니다.')
  await expect(playerAlert.getByRole('link', { name: 'YouTube에서 열기' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  )

  await playerAlert.getByRole('button', { name: '다시 시도' }).click()
  await expect(player.getByRole('status')).toContainText('YouTube 플레이어가 준비되었습니다.')
  await expect(player).toHaveAttribute('aria-busy', 'false')
  const videoFrame = page.locator('.video-frame')
  const iframe = player.locator('.youtube-player-host > iframe')
  await expect(iframe).toBeVisible()

  await expectLocatorContained(videoFrame, iframe)
  expect(scriptAttempts).toBe(2)
})

test('reflows event controls at a 200 percent zoom-equivalent width and text size', { tag: '@mobile' }, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 820 })
  await page.goto('/?mockPlayer=1#/events')
  await expect(page.locator('.event-day-cell[data-date="2026-05-21"]')).toBeVisible()

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })

  await expect(page.getByRole('heading', { name: 'Event Calendar' })).toBeVisible()
  const addEventButton = page.getByRole('button', { name: '일정 추가' })
  const today = page.locator('.event-day-cell[data-date="2026-05-21"]')
  await expect(addEventButton).toBeVisible()
  await expectLocatorMinTouchTarget(addEventButton)
  await expectLocatorMinTouchTarget(today)
  await expectPageContained(page)
})
