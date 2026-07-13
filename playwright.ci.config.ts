import { defineConfig } from '@playwright/test'
import localConfig from './playwright.config'

export default defineConfig({
  ...localConfig,
  use: {
    ...localConfig.use,
    baseURL: 'http://127.0.0.1:4173',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
})
