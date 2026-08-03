import { defineConfig } from '@playwright/test'
import localConfig from './playwright.config'

export default defineConfig({
  ...localConfig,
  failOnFlakyTests: true,
  reporter: [
    ['dot'],
    ['html', { open: 'never' }],
  ],
  retries: 1,
  use: {
    ...localConfig.use,
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  workers: 1,
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
})
