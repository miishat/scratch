import { defineConfig, devices } from '@playwright/test'

// Browser tests run against the production build served by vite preview, never the
// dev server, because offline behavior only exists in the built service worker.
const PORT = 4173

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180000,
  },
})
