import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { startUpdatableHost } from './helpers'

// Offline behavior of the production preview build. Each case uses its own browser
// context, so service worker registrations and IndexedDB never leak between cases.

const PASSPHRASE = 'correct horse battery staple'
const SECRET_TEXT = 'sk_live_offline_secret_9f3a1c'
const NOTE_TITLE = 'Offline warm note'
const NOTE_BODY = `Body text kept on this device ${SECRET_TEXT}`

async function waitForControl(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15000 })
}

async function unlock(page: Page) {
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
}

async function fillNote(page: Page, title: string, body: string) {
  await page.getByRole('textbox', { name: 'Note body' }).fill(body)
  await page.getByRole('button', { name: 'Add title' }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(title)).toBeVisible()
}

async function addNoteFromHeader(page: Page) {
  await page.getByRole('button', { name: 'New note', exact: true }).click()
}

// Creates the library online with one note, then waits until the worker controls the page.
async function warm(context: BrowserContext, entry = '/') {
  const page = await context.newPage()
  await page.goto(entry)
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await page.getByLabel('Confirm passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Create vault' }).click()
  await page.locator('.empty-actions').getByRole('button', { name: 'Add note' }).click()
  await fillNote(page, NOTE_TITLE, NOTE_BODY)
  await waitForControl(page)
  return page
}

// Warms the library on a host this spec controls, then stops that host, so offline is
// real: nothing answers at all. Playwright's context.setOffline is not used because in
// WebKit it makes every navigation fail with an internal error, even for a page the
// service worker controls, which says nothing about the app.
async function reopenOffline(context: BrowserContext, baseURL: string, watch?: (page: Page) => void): Promise<Page> {
  const host = await startUpdatableHost(baseURL)
  const first = await warm(context, host.url)
  await first.close()
  await host.close()
  const page = await context.newPage()
  watch?.(page)
  await page.goto(host.url)
  return page
}

test('warm offline: the shell opens, unlocks, and keeps saved notes', async ({ context, baseURL }) => {
  const page = await reopenOffline(context, baseURL!)
  await expect(page.getByRole('heading', { name: 'Unlock Scratch' })).toBeVisible()
  await unlock(page)
  await expect(page.getByText(NOTE_TITLE)).toBeVisible()
  await page.getByText(NOTE_TITLE).click()
  await expect(page.getByText(NOTE_BODY)).toBeVisible()
})

test('offline write: a note saved offline survives a reload with no failed requests', async ({ context, baseURL }) => {
  const failures: string[] = []
  const page = await reopenOffline(context, baseURL!, (opened) => opened.on('requestfailed', (request) => failures.push(request.url())))
  await unlock(page)
  await expect(page.getByText(NOTE_TITLE)).toBeVisible()
  await addNoteFromHeader(page)
  await fillNote(page, 'Written offline', 'Offline body')
  await page.reload()
  await unlock(page)
  await expect(page.getByText('Written offline')).toBeVisible()
  await expect(page.getByText(NOTE_TITLE)).toBeVisible()
  expect(failures).toEqual([])
})

test('search, export, and import work offline', async ({ context, baseURL }, testInfo) => {
  const page = await reopenOffline(context, baseURL!)
  await unlock(page)
  await page.getByRole('searchbox', { name: 'Search' }).fill('Offline warm')
  await expect(page.getByText(NOTE_TITLE)).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search' }).fill('')

  await page.getByRole('button', { name: 'Settings' }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export backup' }).click()
  const file = testInfo.outputPath('offline.scratch')
  await (await downloading).saveAs(file)

  // The exported file replaces the library again through the real file input.
  await page.getByRole('button', { name: 'Import backup' }).click()
  await page.getByLabel('Backup file').setInputFiles(file)
  await page.getByLabel('Backup passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Review backup' }).click()
  await expect(page.getByText('This backup contains 1 item.')).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Replace library' }).click()
  await expect(page.getByText(NOTE_TITLE)).toBeVisible({ timeout: 30000 })
})

test('unseen install: a fresh browser that starts offline cannot load the app', async ({ browser }) => {
  const context = await browser.newContext({ offline: true })
  try {
      const page = await context.newPage()
      await expect(page.goto('/')).rejects.toThrow()
      expect(context.serviceWorkers()).toHaveLength(0)
  } finally {
    await context.close()
  }
})

async function stageUpdate(host: { bump: () => void }, page: Page) {
  host.bump()
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration?.update()
  })
  await expect(page.getByRole('button', { name: 'Update now' })).toBeVisible({ timeout: 30000 })
}

const hasWaiting = (page: Page) => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting != null)

test('update while dirty: Cancel keeps the draft and the worker waits', async ({ context, baseURL }) => {
  const host = await startUpdatableHost(baseURL!)
  try {
    const page = await warm(context, host.url)
    await addNoteFromHeader(page)
    await page.getByRole('textbox', { name: 'Note body' }).fill('Unsaved draft text')
    await stageUpdate(host, page)
    await page.getByRole('button', { name: 'Update now' }).click()
    const dialog = page.getByRole('dialog', { name: 'Update Scratch?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('textbox', { name: 'Note body' })).toHaveValue('Unsaved draft text')
    expect(await hasWaiting(page)).toBe(true)
  } finally {
    await host.close()
  }
})

test('save failure update: no activation and no forced reload', async ({ context, baseURL }) => {
  const host = await startUpdatableHost(baseURL!)
  try {
    const page = await warm(context, host.url)
    await addNoteFromHeader(page)
    await page.getByRole('textbox', { name: 'Note body' }).fill('Draft that cannot be saved')
    await stageUpdate(host, page)
    await page.evaluate(() => {
      ;(window as unknown as { __alive: boolean }).__alive = true
      // Storage writes now fail, so Save and update cannot save.
      const fail = () => { throw new DOMException('Quota', 'QuotaExceededError') }
    IDBObjectStore.prototype.put = fail
    IDBObjectStore.prototype.add = fail
    })
    await page.getByRole('button', { name: 'Update now' }).click()
    await page.getByRole('button', { name: 'Save and update' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Not updated' })).toBeVisible()
    expect(await hasWaiting(page)).toBe(true)
    expect(await page.evaluate(() => (window as unknown as { __alive?: boolean }).__alive)).toBe(true)
    await expect(page.getByRole('textbox', { name: 'Note body' })).toHaveValue('Draft that cannot be saved')
  } finally {
    await host.close()
  }
})

test('approved update on a clean editor reloads to the locked vault screen', async ({ context, baseURL }) => {
  const host = await startUpdatableHost(baseURL!)
  try {
    const page = await warm(context, host.url)
    await stageUpdate(host, page)
    await page.getByRole('button', { name: 'Update now' }).click()
    await expect(page.getByRole('heading', { name: 'Unlock Scratch' })).toBeVisible({ timeout: 30000 })
    await unlock(page)
    await expect(page.getByText(NOTE_TITLE)).toBeVisible()
  } finally {
    await host.close()
  }
})

test('cache privacy: caches hold only static shell files', async ({ context }, testInfo) => {
  const page = await warm(context)
  await page.getByRole('button', { name: 'Settings' }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export backup' }).click()
  await (await downloading).saveAs(testInfo.outputPath('privacy.scratch'))
  const entries = await page.evaluate(async () => {
    const found: { url: string, text: string }[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        const response = await cache.match(request)
        const type = response?.headers.get('content-type') ?? ''
        const binary = /font|image/.test(type)
        found.push({ url: request.url, text: binary ? '' : (await response?.text()) ?? '' })
      }
    }
    return found
  })
  expect(entries.length).toBeGreaterThan(0)
  for (const entry of entries) {
    const path = new URL(entry.url).pathname
    expect(path).toMatch(/(\/|\.html|\.js|\.css|\.woff2|\.png|\.webmanifest)$/)
    for (const secret of [SECRET_TEXT, NOTE_TITLE, NOTE_BODY, PASSPHRASE]) expect(entry.text).not.toContain(secret)
  }
})

test('license files are served as files, not replaced by the app shell', async ({ context }) => {
  const page = await warm(context)
  // A navigation is what the worker's app-shell fallback would otherwise answer.
  const license = await context.newPage()
  await license.goto('/licenses/public-sans-OFL.txt')
  await expect(license.locator('body')).toContainText('SIL OPEN FONT LICENSE')
  await expect(license.locator('#root')).toHaveCount(0)
  await page.close()
})

test.describe('phone width', () => {
  test.use({ viewport: { width: 360, height: 640 } })

  test('the update prompt inside the editor is keyboard reachable and never covers Save', async ({ context, baseURL }) => {
    const host = await startUpdatableHost(baseURL!)
    try {
      const page = await warm(context, host.url)
      await addNoteFromHeader(page)
      await page.getByRole('textbox', { name: 'Note body' }).fill('Kept while updating')
      await stageUpdate(host, page)
      const dialog = page.getByRole('dialog', { name: 'New note' })
      const update = dialog.getByRole('button', { name: 'Update now' })
      await expect(update).toBeVisible()
      const banner = await dialog.locator('.update-notice').boundingBox()
      const save = await dialog.getByRole('button', { name: 'Save', exact: true }).boundingBox()
      expect(banner && save && (banner.y + banner.height <= save.y || save.y + save.height <= banner.y)).toBe(true)
      expect(banner!.x).toBeGreaterThanOrEqual(0)
      expect(banner!.x + banner!.width).toBeLessThanOrEqual(360)
      for (let i = 0; i < 12; i++) {
        if (await update.evaluate((element) => element === document.activeElement)) break
        await page.keyboard.press('Tab')
      }
      await expect(update).toBeFocused()
      await page.keyboard.press('Enter')
      const confirm = page.getByRole('dialog', { name: 'Update Scratch?' })
      await expect(confirm).toBeVisible()
      await confirm.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByRole('textbox', { name: 'Note body' })).toBeFocused()
      await expect(page.getByRole('textbox', { name: 'Note body' })).toHaveValue('Kept while updating')
      expect(await hasWaiting(page)).toBe(true)
    } finally {
      await host.close()
    }
  })
})
