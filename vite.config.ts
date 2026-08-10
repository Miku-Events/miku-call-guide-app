import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createReleaseMarkerPlugin } from './scripts/release-marker.mjs'
import { generateStaticHeaders } from './scripts/static-headers.mjs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')

  return {
    build: {
      license: { fileName: 'THIRD_PARTY_LICENSES.md' },
      manifest: true,
    },
    plugins: [
      react(),
      tailwindcss(),
      createReleaseMarkerPlugin({
        GITHUB_SHA: process.env.GITHUB_SHA,
        VITE_RELEASE_ID: process.env.VITE_RELEASE_ID || environment.VITE_RELEASE_ID,
      }),
      {
        name: 'cloudflare-static-security-headers',
        apply: 'build',
        generateBundle() {
          this.emitFile({
            fileName: '_headers',
            source: generateStaticHeaders(environment),
            type: 'asset',
          })
        },
      },
      {
        name: 'third-party-notices',
        apply: 'build',
        generateBundle() {
          this.emitFile({
            fileName: 'THIRD_PARTY_NOTICES.md',
            source: readFileSync(new URL('./THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
            type: 'asset',
          })
        },
      },
    ],
  }
})
