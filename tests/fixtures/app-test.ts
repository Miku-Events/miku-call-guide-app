import { expect, test as base, type Page, type Route } from '@playwright/test'
import { validateRuntimeSong } from '../../data-contracts/validators.mjs'
import {
  callGuideManifest,
  dateOnlyEventDetail,
  eventCalendarIndex,
  eventCalendarMayMonth,
  eventCalendarMonth,
  eventDetail,
  multiDayEventDetail,
  rootManifest,
  song,
} from './data'

interface MockSession {
  authenticated: boolean
  login?: string
}

const mockedSongs = new WeakMap<Page, unknown>()
const mockedSessions = new WeakMap<Page, MockSession>()

export const VERSIONED_LEAF_ROUTES = Object.freeze({
  multiDayEvent: /\/event-calendar\/events\/miku-multi-day-popup-sample\.json(?:\?.*)?$/,
  dateOnlyEvent: /\/event-calendar\/events\/second-miku-thanks-festival-2026\.json(?:\?.*)?$/,
  practiceEvent: /\/event-calendar\/events\/miku-practice-sample\.json(?:\?.*)?$/,
  song: /\/songs\/future-light-sample\.json(?:\?.*)?$/,
})

async function fulfillVersionedLeaf(route: Route, json: unknown): Promise<void> {
  const requestUrl = new URL(route.request().url())
  expect(requestUrl.searchParams.get('_miku_data_version')).toBe('e2e')
  await route.fulfill({ json })
}

export function setMockedSong(page: Page, candidate: unknown): void {
  expect(validateRuntimeSong(candidate), JSON.stringify(validateRuntimeSong.errors ?? [])).toBe(true)
  mockedSongs.set(page, candidate)
}

export function setMockedSession(page: Page, session: MockSession): void {
  mockedSessions.set(page, session)
}

export const test = base.extend<{ appMocks: void }>({
  appMocks: [async ({ page }, use) => {
    setMockedSong(page, song)
    setMockedSession(page, { authenticated: false })

    await page.route('**/manifest.json', async (route) => {
      await route.fulfill({ json: rootManifest })
    })
    await page.route('**/call-guide-manifest.json', async (route) => {
      await route.fulfill({ json: callGuideManifest })
    })
    await page.route('**/event-calendar/index.json', async (route) => {
      await route.fulfill({ json: eventCalendarIndex })
    })
    await page.route('**/event-calendar/months/2026-05.json', async (route) => {
      await route.fulfill({ json: eventCalendarMayMonth })
    })
    await page.route('**/event-calendar/months/2026-06.json', async (route) => {
      await route.fulfill({ json: eventCalendarMonth })
    })
    await page.route(VERSIONED_LEAF_ROUTES.multiDayEvent, async (route) => {
      await fulfillVersionedLeaf(route, multiDayEventDetail)
    })
    await page.route(VERSIONED_LEAF_ROUTES.dateOnlyEvent, async (route) => {
      await fulfillVersionedLeaf(route, dateOnlyEventDetail)
    })
    await page.route(VERSIONED_LEAF_ROUTES.practiceEvent, async (route) => {
      await fulfillVersionedLeaf(route, eventDetail)
    })
    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({ json: mockedSessions.get(page) ?? { authenticated: false } })
    })
    await page.route('https://platform.x.com/widgets.js', async (route) => {
      await route.fulfill({
        body: 'window.twttr={widgets:{load:function(){}}};',
        contentType: 'application/javascript',
      })
    })
    await page.route('https://i.ytimg.com/**', async (route) => {
      await route.fulfill({
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
        contentType: 'image/gif',
      })
    })
    await page.route(VERSIONED_LEAF_ROUTES.song, async (route) => {
      await fulfillVersionedLeaf(route, mockedSongs.get(page) ?? song)
    })

    await use()
  }, { auto: true }],
})

export { expect }
