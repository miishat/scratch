import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import {
  addCollection, addNote, createLibrary, exportBackup, fillEditor, importBackupOnSetup,
  independentContextOptions, openAddMenu, PASSPHRASE, startUpdatableHost, SYNTHETIC_TOKEN, unlock, waitForControl,
} from './helpers'

// Whole-product flows through the real UI of the production preview build. The same
// specs run on desktop and phone projects, so capability parity is checked by
// construction: nothing here is skipped or reshaped per viewport.

const ORDINARY_BODY = 'Buy oat milk\nand fresh bread from the corner shop'
const EDITED_BODY = 'Buy oat milk\nand sourdough instead of bread'

async function copyAndReadBack(page: Page, name: string, browserName: string): Promise<string | null> {
  await page.getByRole('button', { name: `Copy ${name}` }).click()
  await expect(page.getByText('Copied', { exact: true })).toBeVisible()
  // Reading the clipboard back needs a permission only Chromium lets a test grant.
  if (browserName !== 'chromium') return null
  // The Windows system clipboard stores line breaks as CRLF; the app writes the text
  // unchanged (asserted exactly in the clipboard unit tests), so only that is folded.
  const text = await page.evaluate(() => navigator.clipboard.readText())
  return text.split('\r\n').join('\n')
}

test('a library lives through creation, organization, search, reload, transfer, and offline restore', async ({ browser, baseURL, context, page, browserName }, testInfo) => {
  test.slow()
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  {
    await test.step('create the library', async () => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Set up Scratch' })).toBeVisible()
      await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
      await page.getByLabel('Confirm passphrase').fill(PASSPHRASE)
      await page.getByRole('button', { name: 'Create vault' }).click()
      await expect(page.getByRole('heading', { name: 'A place for the little things.' })).toBeVisible({ timeout: 30000 })
    })

    await test.step('create the API Tokens collection', async () => {
      await addCollection(page, 'API Tokens', 'Slate')
      await expect(page.getByText('Collection created', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'API Tokens, 0 items' })).toBeVisible()
      await expect(page.locator('.tile[data-color="slate"]')).toHaveCount(1)
    })

    await test.step('save a titled OpenAI secret note inside it', async () => {
      await page.getByRole('link', { name: 'API Tokens, 0 items' }).click()
      await expect(page.getByRole('heading', { name: 'API Tokens', level: 1 })).toBeVisible()
      await openAddMenu(page, 'Add note')
      await expect(page.getByRole('dialog', { name: 'New note' })).toBeVisible()
      await fillEditor(page, { body: SYNTHETIC_TOKEN, title: 'OpenAI', secret: true })
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Saved', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'OpenAI, secret note' })).toBeVisible()
      // The tile shows the title and a mask, never the token.
      await expect(page.locator('body')).not.toContainText(SYNTHETIC_TOKEN)
    })

    await test.step('save an ordinary note without a title and see a derived title', async () => {
      await page.getByRole('link', { name: 'Scratch home' }).click()
      await addNote(page, { body: ORDINARY_BODY })
      await expect(page.getByRole('link', { name: 'Buy oat milk', exact: true })).toBeVisible()
    })

    await test.step('edit the note and see the change persist in the reader', async () => {
      await page.getByRole('link', { name: 'Buy oat milk', exact: true }).click()
      const reader = page.getByRole('dialog', { name: 'Note' })
      await expect(reader).toContainText('and fresh bread from the corner shop')
      await reader.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByRole('textbox', { name: 'Note body' }).fill(EDITED_BODY)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      await page.getByRole('link', { name: 'Buy oat milk', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Note' })).toContainText('and sourdough instead of bread')
      await page.getByRole('dialog', { name: 'Note' }).getByRole('button', { name: 'Close' }).first().click()
      await expect(page.getByRole('dialog')).toBeHidden()
    })

    await test.step('nest a collection and move the note into it', async () => {
      await page.getByRole('link', { name: 'API Tokens, 1 item' }).click()
      await addCollection(page, 'Work', 'Clay')
      await expect(page.getByRole('link', { name: 'Work, 0 items' })).toBeVisible()
      await page.getByRole('link', { name: 'Scratch home' }).click()
      await page.getByRole('button', { name: 'More actions for Buy oat milk' }).click()
      await page.getByRole('button', { name: 'Move', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Move' })
      await dialog.getByRole('radio', { name: 'API Tokens / Work' }).check()
      await dialog.getByRole('button', { name: 'Move here' }).click()
      await expect(page.getByText('Moved to Work', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Buy oat milk', exact: true })).toHaveCount(0)
    })

    await test.step('Back and Forward walk the hierarchy', async () => {
      await page.getByRole('link', { name: 'API Tokens, 2 items' }).click()
      await page.getByRole('link', { name: 'Work, 1 item' }).click()
      await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Buy oat milk', exact: true })).toBeVisible()
      await page.goBack()
      await expect(page.getByRole('heading', { name: 'API Tokens', level: 1 })).toBeVisible()
      await page.goBack()
      await expect(page.getByRole('link', { name: 'API Tokens, 2 items' })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: 'API Tokens' })).toHaveCount(0)
      await page.goForward()
      await expect(page.getByRole('heading', { name: 'API Tokens', level: 1 })).toBeVisible()
      await page.goForward()
      await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible()
    })

    await test.step('search finds the note, names where it lives, and copies it exactly', async () => {
      await page.getByRole('searchbox', { name: 'Search' }).fill('sourdough')
      await expect(page.getByRole('status').filter({ hasText: '1 result' })).toBeAttached()
      const results = page.getByRole('list', { name: 'Search results' })
      await expect(results.getByRole('link', { name: /Buy oat milk, in api tokens \/ work/i })).toBeVisible()
      const copied = await copyAndReadBack(page, 'Buy oat milk', browserName)
      if (copied !== null) expect(copied).toBe(EDITED_BODY)
      await page.getByRole('searchbox', { name: 'Search' }).fill('')
      await expect(page.getByRole('list', { name: 'Search results' })).toHaveCount(0)
    })

    await test.step('the theme follows the system colour scheme while running', async () => {
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await page.emulateMedia({ colorScheme: 'light' })
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    })

    // The app has no Settings control for the theme yet, but ThemeProvider persists an
    // explicit preference under this key and the pre-paint script in index.html reads
    // it. The key is seeded directly; what is asserted is that an explicit Dark choice
    // beats the system scheme (light) across a reload, before and after unlock.
    await test.step('an explicit Dark preference survives a reload while the system is light', async () => {
      await page.evaluate(() => localStorage.setItem('scratch-theme', 'dark'))
      await page.emulateMedia({ colorScheme: 'light' })
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Unlock Scratch' })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await unlock(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await page.evaluate(() => localStorage.removeItem('scratch-theme'))
      await page.emulateMedia({ colorScheme: 'dark' })
    })

    await test.step('a reload locks the library and unlocking brings back every item', async () => {
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Unlock Scratch' })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await expect(page.locator('body')).not.toContainText('API Tokens')
      await unlock(page)
      // The place in the hierarchy is kept by the address; only the content was locked.
      await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible()
      await page.getByRole('link', { name: 'Scratch home' }).click()
      await expect(page.getByRole('link', { name: 'API Tokens, 2 items' })).toBeVisible()
      await page.getByRole('link', { name: 'API Tokens, 2 items' }).click()
      await page.getByRole('link', { name: 'Work, 1 item' }).click()
      await page.getByRole('link', { name: 'Buy oat milk', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Note' })).toContainText('and sourdough instead of bread')
      await page.getByRole('dialog', { name: 'Note' }).getByRole('button', { name: 'Close' }).first().click()
    })

    let backup = ''
    await test.step('export a backup that carries no readable content', async () => {
      backup = await exportBackup(page, testInfo, 'journey.scratch')
      const text = await readFile(backup, 'utf8')
      for (const secret of [SYNTHETIC_TOKEN, 'OpenAI', 'Buy oat milk', 'API Tokens', PASSPHRASE]) expect(text).not.toContain(secret)
    })

    // The second context talks to its own pass-through host so that, later, stopping the
    // host is real offline (Playwright's setOffline breaks WebKit navigations, see offline.spec).
    const host = await startUpdatableHost(baseURL!)
    const second = await browser.newContext({ ...independentContextOptions(testInfo), baseURL: host.url })
    try {
      const other = await second.newPage()
      await test.step('a second, independent context restores the exact library', async () => {
        await importBackupOnSetup(other, backup, 4)
        await expect(other.getByRole('link', { name: 'API Tokens, 2 items' })).toBeVisible()
        await other.getByRole('link', { name: 'API Tokens, 2 items' }).click()
        await expect(other.getByRole('link', { name: 'OpenAI, secret note' })).toBeVisible()
        // The secret itself, not just its title, made the trip: reveal it and compare.
        await other.getByRole('link', { name: 'OpenAI, secret note' }).click()
        await other.getByRole('dialog', { name: 'Note' }).getByRole('button', { name: 'Reveal' }).click()
        await expect(other.getByRole('dialog', { name: 'Note' }).locator('pre')).toHaveText(SYNTHETIC_TOKEN)
        await other.getByRole('dialog', { name: 'Note' }).getByRole('button', { name: 'Close' }).first().click()
        await other.getByRole('link', { name: 'Work, 1 item' }).click()
        await other.getByRole('link', { name: 'Buy oat milk', exact: true }).click()
        await expect(other.getByRole('dialog', { name: 'Note' })).toContainText('and sourdough instead of bread')
        await other.getByRole('dialog', { name: 'Note' }).getByRole('button', { name: 'Close' }).first().click()
      })
      await test.step('the restored library reopens and works offline', async () => {
        await waitForControl(other)
        await other.close()
        await host.close()
        const offline = await second.newPage()
        await offline.goto(host.url)
        await unlock(offline)
        await expect(offline.getByRole('link', { name: 'API Tokens, 2 items' })).toBeVisible()
        await addNote(offline, { body: 'Written while offline' })
        await offline.reload()
        await unlock(offline)
        await expect(offline.getByRole('link', { name: 'Written while offline', exact: true })).toBeVisible()
      })
    } finally {
      await second.close()
      await host.close()
    }
  }
})

test('main task speed: unlocked Add, Note, type, Save needs no title, wizard, or detour', async ({ page }) => {
  await createLibrary(page)
  const dialogs = page.getByRole('dialog')
  await openAddMenu(page, 'Add note')
  // The very next keystrokes land in the body: no title step stands in the way.
  await expect(page.getByRole('textbox', { name: 'Note body' })).toBeFocused()
  await expect(dialogs).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'New note' })).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveCount(0)
  await page.keyboard.type('Quick thought, no title')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialogs).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Quick thought, no title', exact: true })).toBeVisible()
  // Focus returns to Add so the next capture is one activation away.
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeFocused()
})

test('responsive parity: capture, find, copy, move, and back up work the same at this width', async ({ context, page, browserName }, testInfo) => {
  test.slow()
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  {
    await createLibrary(page)
    // capture
    await addCollection(page, 'Parity box')
    await addNote(page, { body: 'Parity capture works' })
    // find
    await page.getByRole('searchbox', { name: 'Search' }).fill('capture works')
    await expect(page.getByRole('link', { name: 'Parity capture works', exact: true })).toBeVisible()
    // copy
    const copied = await copyAndReadBack(page, 'Parity capture works', browserName)
    if (copied !== null) expect(copied).toBe('Parity capture works')
    await page.getByRole('searchbox', { name: 'Search' }).fill('')
    // move
    await page.getByRole('button', { name: 'More actions for Parity capture works' }).click()
    await page.getByRole('button', { name: 'Move', exact: true }).click()
    await page.getByRole('radio', { name: 'Parity box' }).check()
    await page.getByRole('button', { name: 'Move here' }).click()
    await expect(page.getByText('Moved to Parity box', { exact: true })).toBeVisible()
    // backup
    const path = await exportBackup(page, testInfo, 'parity.scratch')
    expect((await readFile(path, 'utf8')).length).toBeGreaterThan(100)
    // every one of these controls is a real, visible, in-viewport control at this width
    const viewport = page.viewportSize()!
    for (const name of ['Add', 'Settings']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox()
      expect(box && box.x >= 0 && box.x + box.width <= viewport.width, `${name} fits the viewport`).toBe(true)
    }
  }
})

test.describe('dirty lifecycle', () => {
  test('Cancel on a dirty draft asks first, Keep editing keeps it, Discard drops only on request', async ({ page }) => {
    await createLibrary(page)
    await openAddMenu(page, 'Add note')
    await page.getByRole('textbox', { name: 'Note body' }).fill('Precious unsaved words')
    await page.getByRole('button', { name: 'Cancel' }).click()
    const prompt = page.getByRole('group', { name: 'Unsaved changes' })
    await expect(prompt).toBeVisible()
    await expect(prompt.getByRole('button', { name: 'Keep editing' })).toBeFocused()
    await prompt.getByRole('button', { name: 'Keep editing' }).click()
    await expect(page.getByRole('textbox', { name: 'Note body' })).toHaveValue('Precious unsaved words')
    // Escape is the same request to leave, never a silent dismissal.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('group', { name: 'Unsaved changes' })).toBeVisible()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await expect(page.getByRole('textbox', { name: 'Note body' })).toHaveValue('Precious unsaved words')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('link', { name: /Precious/ })).toHaveCount(0)
  })

  test('browser Back with a dirty draft is refused and keeps the draft and the place', async ({ page }) => {
    await createLibrary(page)
    await addCollection(page, 'Guarded')
    await page.getByRole('link', { name: 'Guarded, 0 items' }).click()
    await expect(page.getByRole('heading', { name: 'Guarded', level: 1 })).toBeVisible()
    const where = page.url()
    await openAddMenu(page, 'Add note')
    await page.getByRole('textbox', { name: 'Note body' }).fill('Draft that Back must not eat')
    await page.goBack()
    await expect(page.getByRole('group', { name: 'Unsaved changes' })).toBeVisible()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await expect(page.getByRole('textbox', { name: 'Note body' })).toHaveValue('Draft that Back must not eat')
    // The refused traversal is undone asynchronously, so the address is polled.
    await expect.poll(() => page.url()).toBe(where)
    // Saving then works and lands the note in the collection that was open.
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Draft that Back must not eat', exact: true })).toBeVisible()
  })

  test('an automatic lock seals the draft, hides it while locked, and returns it after unlock', async ({ page }) => {
    await page.clock.install()
    await createLibrary(page)
    await openAddMenu(page, 'Add note')
    await page.getByRole('textbox', { name: 'Note body' }).fill('Draft that survives an idle lock')
    await page.clock.fastForward('11:00')
    await expect(page.getByRole('heading', { name: 'Unlock Scratch' })).toBeVisible({ timeout: 30000 })
    await expect(page.locator('body')).not.toContainText('Draft that survives an idle lock')
    await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByRole('textbox', { name: 'Note body' })).toHaveValue('Draft that survives an idle lock', { timeout: 30000 })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Draft that survives an idle lock', exact: true })).toBeVisible()
  })

  test('a failed save keeps the draft on screen with the reason, and nothing was written', async ({ page }) => {
    await createLibrary(page)
    await openAddMenu(page, 'Add note')
    await page.getByRole('textbox', { name: 'Note body' }).fill('Draft that cannot be saved yet')
    await page.evaluate(() => {
      const fail = () => { throw new DOMException('Quota', 'QuotaExceededError') }
      IDBObjectStore.prototype.put = fail
      IDBObjectStore.prototype.add = fail
    })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    // The reason is the storage-full message, shown in the editor's own alert.
    await expect(page.getByRole('dialog', { name: 'New note' }).getByRole('alert')).toHaveText('Not enough storage space to save. Free some space and try again.')
    await expect(page.getByRole('textbox', { name: 'Note body' })).toHaveValue('Draft that cannot be saved yet')
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    // Nothing reached storage: after a reload and unlock the library holds no such note.
    // The dirty draft makes the browser ask before leaving; accept it.
    page.on('dialog', (dialog) => void dialog.accept())
    await page.reload()
    await unlock(page)
    await expect(page.getByRole('heading', { name: 'A place for the little things.' })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('Draft that cannot be saved yet')
    await expect(page.locator('.note-tile')).toHaveCount(0)
  })

  test('a modal editor keeps keyboard focus inside, so page controls behind it are unreachable', async ({ page }) => {
    await createLibrary(page)
    await openAddMenu(page, 'Add note')
    await page.getByRole('textbox', { name: 'Note body' }).fill('Open editor draft')
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), `Tab stop ${i + 1} is inside the editor`).toBe(true)
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), `Shift+Tab stop ${i + 1} is inside the editor`).toBe(true)
    }
  })
})
