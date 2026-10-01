import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { addCollection, addNote, createLibrary, fillEditor, openAddMenu, openSettings, SYNTHETIC_TOKEN } from './helpers'

// A review artifact, not an assertion: light and dark captures of the main screens at
// desktop and phone size, written to docs/verification-screenshots/. It runs only when
// CAPTURE_SCREENSHOTS=1 (see playwright.config.ts) and compares nothing, so style
// changes never break a build. Every note is synthetic.

const OUT = resolve(process.cwd(), 'docs/verification-screenshots')
const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 720 } },
  { name: 'phone', viewport: { width: 360, height: 740 } },
] as const

async function shot(page: Page, theme: string, size: string, name: string) {
  // Transient messages (the first-visit offline notice and the save toast) would sit on
  // top of the screen being reviewed; wait until they have gone by themselves.
  await expect(page.locator('.update-status')).toHaveCount(0, { timeout: 12000 })
  await expect(page.locator('.toast-region')).toBeEmpty({ timeout: 8000 })
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${OUT}/${theme}-${size}-${name}.png`, animations: 'disabled', caret: 'hide' })
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const size of SIZES) {
    test.describe(`${colorScheme} ${size.name}`, () => {
      test.use({ colorScheme, viewport: size.viewport })

      test('capture the main screens', async ({ page }) => {
        test.setTimeout(240000)
        await mkdir(OUT, { recursive: true })
        await createLibrary(page)
        await shot(page, colorScheme, size.name, '1-empty')

        await addCollection(page, 'Work', 'Sage')
        await addCollection(page, 'Home', 'Clay')
        await addCollection(page, 'Trips', 'Ochre')
        await addCollection(page, 'API Tokens', 'Slate')
        await addNote(page, { body: 'Buy oat milk\nand fresh bread from the corner shop' })
        await addNote(page, { body: 'Call the dentist about Thursday' })
        await shot(page, colorScheme, size.name, '2-home')

        await page.getByRole('link', { name: 'API Tokens, 0 items' }).click()
        await addNote(page, { body: SYNTHETIC_TOKEN, title: 'OpenAI', secret: true })
        await addNote(page, { body: 'Staging deploy key lives in the shared vault.\nRotate it every quarter.', title: 'Deploy notes' })
        await addCollection(page, 'Archived keys', 'Clay')
        await shot(page, colorScheme, size.name, '3-collection')

        await page.getByRole('link', { name: 'OpenAI, secret note' }).click()
        await page.getByRole('button', { name: 'Reveal' }).click()
        await shot(page, colorScheme, size.name, '4-secret-revealed')
        await page.getByRole('button', { name: 'Close' }).first().click()

        await page.getByRole('searchbox', { name: 'Search' }).fill('key')
        await page.getByRole('list', { name: 'Search results' }).waitFor()
        await shot(page, colorScheme, size.name, '5-search-results')
        await page.getByRole('searchbox', { name: 'Search' }).fill('nothing matches this')
        await shot(page, colorScheme, size.name, '6-search-empty')
        await page.getByRole('searchbox', { name: 'Search' }).fill('')

        await openSettings(page)
        await shot(page, colorScheme, size.name, '7-settings')
        await page.keyboard.press('Escape')

        await openAddMenu(page, 'Add note')
        await fillEditor(page, { body: 'Draft that cannot be saved yet', title: 'Draft' })
        await shot(page, colorScheme, size.name, '8-editor')
        await page.evaluate(() => {
          const fail = () => { throw new DOMException('Quota', 'QuotaExceededError') }
          IDBObjectStore.prototype.put = fail
          IDBObjectStore.prototype.add = fail
        })
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await page.getByRole('alert').waitFor()
        await shot(page, colorScheme, size.name, '9-error-save-failed')
      })
    })
  }
}
