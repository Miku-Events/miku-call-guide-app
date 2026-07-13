const LOCAL_RELEASE_ID = 'local-development'
const MAX_RELEASE_ID_LENGTH = 128
const releaseIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function assertReleaseId(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_RELEASE_ID_LENGTH
    || value !== value.trim()
    || !releaseIdPattern.test(value)
    || /^(?:your|replace[-_]?with)[-_]/i.test(value)
  ) {
    throw new Error('Release id must be a non-placeholder 1-128 character public identifier')
  }
  return value
}

export function resolveReleaseId(environment = {}) {
  const configured = environment.VITE_RELEASE_ID || environment.GITHUB_SHA || LOCAL_RELEASE_ID
  return assertReleaseId(configured)
}

export function releaseMarkerSource(releaseId) {
  return `${JSON.stringify({ releaseId: assertReleaseId(releaseId) })}\n`
}

export function createReleaseMarkerPlugin(environment = {}) {
  const releaseId = resolveReleaseId(environment)
  return {
    name: 'release-marker',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        fileName: 'release.json',
        source: releaseMarkerSource(releaseId),
        type: 'asset',
      })
    },
  }
}
