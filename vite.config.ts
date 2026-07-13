import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { generateStaticHeaders } from './scripts/static-headers.mjs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      tailwindcss(),
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
    ],
  }
})
