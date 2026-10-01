import { execFileSync } from 'node:child_process'
import { defineConfig, devices, firefox } from '@playwright/test'

// Browser tests run against the production build served by vite preview, never the
// dev server, because offline behavior only exists in the built service worker.
const PORT = 4173

// 360 px is the design brief's phone width and 1280 px its desktop width. The
// device presets supply touch, user agent and pixel ratio; the viewport is pinned
// to those two widths so every project runs the same layout contract.
const DESKTOP = { width: 1280, height: 720 }
const PHONE = { width: 360, height: 740 }

// Specs that exercise the whole app on every project, desktop and phone.
const FUNCTIONAL = [/scratch\.spec\.ts/, /transfers\.spec\.ts/, /reflow\.spec\.ts/]
// Desktop-only specs: service worker control, update hosting and storage scans are
// engine-level behavior that does not change with the viewport.
const DESKTOP_ONLY = [...FUNCTIONAL, /offline\.spec\.ts/, /secrets\.spec\.ts/, /support\.spec\.ts/]

// A browser that is installed but cannot start on this machine (for example Firefox
// failing with a side-by-side configuration error because a system runtime is
// missing) would fail every test with a launch error, which says nothing about
// the app. It is left out with a loud warning; nothing else is skipped.
function launchable(name: string, path: string): boolean {
  try {
    execFileSync(path, ['--version'], { timeout: 20000, stdio: 'ignore' })
    return true
  } catch (error) {
    console.warn(`[playwright] ${name} cannot start on this machine and its project is left out: ${(error as Error).message.split('\n')[0]}`)
    return false
  }
}
const FIREFOX_RUNS = launchable('firefox', firefox.executablePath())

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  // Unlocking runs 600,000 PBKDF2 iterations, so parallelism is capped to keep
  // timings comparable between runs.
  workers: 2,
  expect: { timeout: 8000 },
  use: { baseURL: `http://localhost:${PORT}`, actionTimeout: 15000 },
  projects: [
    { name: 'chromium', testMatch: DESKTOP_ONLY, use: { ...devices['Desktop Chrome'], viewport: DESKTOP } },
    ...(FIREFOX_RUNS ? [{ name: 'firefox', testMatch: DESKTOP_ONLY, use: { ...devices['Desktop Firefox'], viewport: DESKTOP } }] : []),
    { name: 'webkit', testMatch: DESKTOP_ONLY, use: { ...devices['Desktop Safari'], viewport: DESKTOP } },
    { name: 'mobile-chromium', testMatch: FUNCTIONAL, use: { ...devices['Pixel 7'], viewport: PHONE } },
    { name: 'mobile-webkit', testMatch: FUNCTIONAL, use: { ...devices['iPhone 13'], viewport: PHONE } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180000,
  },
})
