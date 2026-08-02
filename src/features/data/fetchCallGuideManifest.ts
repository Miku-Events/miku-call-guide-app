import {
  validateCallGuideManifest,
  validateRootManifest,
} from '../../../data-contracts/validators.mjs'
import { assertContract } from './contractValidation'
import {
  fetchManifestFamily,
  fetchRootManifestWithValidator,
  type ManifestLoadOptions,
} from './manifestFamily'
import type { ResolvedLoadResult } from './manifestShared'
import type { CallGuideManifest, RootManifest } from './types'

const DEFAULT_CALL_GUIDE_MANIFEST_PATH = 'call-guide-manifest.json'

function assertRootManifest(value: unknown): asserts value is RootManifest {
  assertContract(value, validateRootManifest, 'Root manifest response')
}

function assertCallGuideManifest(value: unknown): asserts value is CallGuideManifest {
  assertContract(value, validateCallGuideManifest, 'Call guide manifest response')
}

export function fetchRootManifest(
  rootManifestUrl: string,
  options: ManifestLoadOptions = {},
): Promise<ResolvedLoadResult<RootManifest>> {
  return fetchRootManifestWithValidator(rootManifestUrl, assertRootManifest, options)
}

export function fetchCallGuideManifest(
  rootManifestUrl: string,
  options: ManifestLoadOptions = {},
): Promise<ResolvedLoadResult<CallGuideManifest>> {
  return fetchManifestFamily(rootManifestUrl, {
    assertChild: assertCallGuideManifest,
    assertRoot: assertRootManifest,
    childPath: (root) => root.manifests.callGuide,
    family: 'call-guide',
    label: 'call-guide manifest',
    speculativeChildPath: DEFAULT_CALL_GUIDE_MANIFEST_PATH,
  }, options)
}

export const fetchManifest = fetchCallGuideManifest

export type { ManifestLoadOptions, ResolvedLoadResult }
