import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'panel.spec.ts',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: { baseURL: 'http://127.0.0.1:4781', browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 } },
  reporter: [['list']],
})
