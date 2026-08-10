import {
  validateEventCalendarIndex,
  validateEventCalendarMonth,
  validateRootManifest,
  validateRuntimeEvent,
} from '../../../data-contracts/validators.mjs'
import { assertContract } from './contractValidation'
import {
  fetchManifestFamily,
  fetchRootManifestWithValidator,
  type ManifestLoadOptions,
} from './manifestFamily'
import {
  assertVersion,
  fetchVersionedResource,
  JSON_BYTE_LIMITS,
  type ResolvedLoadResult,
  type VersionedLoadOptions,
} from './manifestShared'
import type {
  EventCalendarIndex,
  EventCalendarMonth,
  EventGuide,
  RootManifest,
} from './types'

function assertRootManifest(value: unknown): asserts value is RootManifest {
  assertContract(value, validateRootManifest, 'Root manifest response')
}

function assertEventCalendarIndex(value: unknown): asserts value is EventCalendarIndex {
  assertContract(value, validateEventCalendarIndex, 'Event calendar index response')
}

function assertEventCalendarMonth(value: unknown): asserts value is EventCalendarMonth {
  assertContract(value, validateEventCalendarMonth, 'Event calendar month response')
}

function assertEventGuide(value: unknown): asserts value is EventGuide {
  assertContract(value, validateRuntimeEvent, 'Event detail response')
}

export function fetchRootManifest(
  rootManifestUrl: string,
  options: ManifestLoadOptions = {},
): Promise<ResolvedLoadResult<RootManifest>> {
  return fetchRootManifestWithValidator(rootManifestUrl, assertRootManifest, options)
}

export function fetchEventCalendarIndex(
  rootManifestUrl: string,
  options: ManifestLoadOptions = {},
): Promise<ResolvedLoadResult<EventCalendarIndex>> {
  return fetchManifestFamily(rootManifestUrl, {
    assertChild: assertEventCalendarIndex,
    assertRoot: assertRootManifest,
    childPath: (root) => root.manifests.eventCalendar,
    family: 'event-calendar',
    label: 'event calendar index',
  }, options)
}

export function fetchEventCalendarMonth(
  eventCalendarIndexUrl: string,
  month: string,
  options: VersionedLoadOptions,
): Promise<ResolvedLoadResult<EventCalendarMonth>> {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
    return Promise.reject(new Error(`Requested event calendar month was invalid: ${month}.`))
  }
  return fetchVersionedResource({
    assertValue: assertEventCalendarMonth,
    checkValue: (value) => {
      if (value.month !== month) {
        throw new Error(`Event calendar month ${value.month} did not match requested ${month}.`)
      }
      assertVersion(value.dataVersion, options.expectedDataVersion, 'Event calendar month')
    },
    label: `${month} event calendar`,
    manifestUrl: eventCalendarIndexUrl,
    maxBytes: JSON_BYTE_LIMITS.aggregate,
    options,
    resourcePath: `months/${month}.json`,
  })
}

export function fetchEventDetail(
  monthManifestUrl: string,
  eventPath: string,
  eventId: string,
  options: VersionedLoadOptions,
): Promise<ResolvedLoadResult<EventGuide>> {
  return fetchVersionedResource({
    assertValue: assertEventGuide,
    checkValue: (value) => {
      if (value.id !== eventId) {
        throw new Error(`Event detail id ${value.id} did not match requested ${eventId}.`)
      }
      assertVersion(value.dataVersion, options.expectedDataVersion, 'Event detail')
    },
    label: 'event detail',
    dedupeKeySuffix: eventId,
    manifestUrl: monthManifestUrl,
    maxBytes: JSON_BYTE_LIMITS.eventDetail,
    options,
    resourcePath: eventPath,
    versionedLeaf: true,
  })
}

export type { ManifestLoadOptions, ResolvedLoadResult, VersionedLoadOptions }
