// Compatibility barrel. Route entry modules should import the call-guide or
// event-specific loader directly so their validator graphs remain independent.
export {
  fetchCallGuideManifest,
  fetchManifest,
  fetchRootManifest,
} from './fetchCallGuideManifest'
export {
  fetchEventCalendarIndex,
  fetchEventCalendarMonth,
  fetchEventDetail,
} from './fetchEventManifest'
export {
  resolveDataUrl,
  resolveVersionedLeafUrl,
  type ResolvedLoadResult,
  type VersionedLoadOptions,
} from './manifestShared'
export type { ManifestLoadOptions } from './manifestFamily'
