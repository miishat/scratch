import { expect, test } from '@playwright/test'

// The unsupported-browser screen when a required API is absent. Each case removes the
// API before any page script runs, which is what an older browser looks like to the app.

const REMOVALS: Record<string, string> = {
  IndexedDB: `Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })`,
  'crypto.subtle': `Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined, configurable: true })`,
  'Intl.Segmenter': `Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true })`,
}

for (const [api, removal] of Object.entries(REMOVALS)) {
  test(`without ${api} the app explains what is missing and offers no vault`, async ({ page }) => {
    await page.addInitScript(removal)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Browser not supported' })).toBeVisible()
    await expect(page.getByText(`Scratch needs these browser features: ${api}.`)).toBeVisible()
    // No form that would collect a passphrase for a vault that cannot be stored or opened.
    await expect(page.getByLabel('Passphrase', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create vault' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0)
  })
}

test('with every required API missing all of them are named, and nothing was stored', async ({ page }) => {
  await page.addInitScript(Object.values(REMOVALS).join(';'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Browser not supported' })).toBeVisible()
  await expect(page.getByText('Scratch needs these browser features: IndexedDB, crypto.subtle, Intl.Segmenter.')).toBeVisible()

  // A plain same-origin file runs no app code, so it shows what storage the failed
  // attempt left behind: none.
  const probe = await page.context().newPage()
  await probe.goto('/licenses/source-sans-3-OFL.txt')
  expect(await probe.evaluate(async () => (await indexedDB.databases()).length)).toBe(0)
})
