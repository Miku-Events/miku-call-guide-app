export interface ReleaseMarkerEnvironment {
  GITHUB_SHA?: string
  VITE_RELEASE_ID?: string
}

export function resolveReleaseId(environment?: ReleaseMarkerEnvironment): string
export function releaseMarkerSource(releaseId: string): string
export function createReleaseMarkerPlugin(environment?: ReleaseMarkerEnvironment): {
  name: string
  apply: 'build'
  generateBundle(this: {
    emitFile(file: {
      fileName: string
      source: string
      type: 'asset'
    }): void
  }): void
}
