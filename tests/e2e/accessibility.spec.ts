import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { addCollection, addNote, createLibrary, fillEditor, openAddMenu, openSettings, PASSPHRASE, SYNTHETIC_TOKEN, unlock } from './helpers'

// Automated accessibility checks (axe-core) across every screen and state in both
// themes at the desktop and phone widths, plus keyboard-only walkthroughs and a
// reduced-motion check. axe finds roughly the machine-checkable part of WCAG; it does
// not replace screen readers, a real phone keyboard, or IME, which are manual checks
// listed in docs/verification.md.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function scan(page: Page, where: string) {
  // Colors are measured at rest: the 120 ms hover fade in progress (a button that
  // mounts under the pointer fades from surface to action) would be sampled
  // mid-blend and report a contrast no one lingers on. Reduced motion is tested below.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const found = results.violations.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ') + ' ' + JSON.stringify(node.any[0]?.data ?? {})).slice(0, 4).join(' | ')}`)
  expect(found, `axe violations on ${where}`).toEqual([])
  // A scan that checked nothing would pass vacuously.
  expect(results.passes.length, `axe ran rules on ${where}`).toBeGreaterThan(5)
}

async function closeTop(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
}

const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 720 } },
  { name: 'phone', viewport: { width: 360, height: 740 } },
] as const

test.describe('axe-core on every screen', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const size of SIZES) {
      test.describe(`${colorScheme} theme, ${size.name}`, () => {
        test.use({ colorScheme, viewport: size.viewport })

        test('setup, empty, home, collection, reader, editor, dialogs, search, settings, backup, locked', async ({ page }) => {
          test.slow()
          await page.goto('/')
          await expect(page.getByRole('heading', { name: 'Set up Scratch' })).toBeVisible()
          await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)
          await scan(page, 'setup')

          await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
          await page.getByLabel('Confirm passphrase').fill('does not match')
          await page.getByRole('button', { name: 'Create vault' }).click()
          await expect(page.locator('.form-error')).toBeVisible()
          await scan(page, 'setup with a form error')

          await page.getByRole('button', { name: 'Import backup' }).click()
          await expect(page.getByRole('dialog')).toBeVisible()
          await scan(page, 'first-use import dialog')
          await closeTop(page)

          await createLibrary(page)
          await scan(page, 'empty home')

          await openAddMenu(page, 'Add collection')
          await scan(page, 'new collection dialog')
          await closeTop(page)
          await addCollection(page, 'Work', 'Sage')
          await addCollection(page, 'Home', 'Clay')
          await addCollection(page, 'Trips', 'Ochre')
          await addCollection(page, 'Ideas', 'Slate')
          await addNote(page, { body: 'A plain note on the home screen' })
          await scan(page, 'home with tiles')

          await page.getByRole('link', { name: 'Work, 0 items' }).click()
          await scan(page, 'empty collection')
          await addNote(page, { body: SYNTHETIC_TOKEN, title: 'OpenAI key', secret: true })
          await addNote(page, { body: 'Buy oat milk and bread' })
          await scan(page, 'collection with notes')

          await page.getByRole('link', { name: 'OpenAI key, secret note' }).click()
          await expect(page.getByRole('dialog', { name: 'Note' })).toBeVisible()
          await scan(page, 'reader with masked secret')
          await page.getByRole('button', { name: 'Reveal' }).click()
          await scan(page, 'reader with revealed secret')
          await page.getByRole('button', { name: 'Edit secret' }).click()
          await scan(page, 'editor')
          await page.getByRole('button', { name: 'Cancel' }).click()

          await openAddMenu(page, 'Add note')
          await fillEditor(page, { body: 'unsaved words', title: 'A title' })
          await page.getByRole('button', { name: 'Cancel' }).click()
          await expect(page.getByRole('dialog', { name: /Discard|Unsaved/i }).or(page.getByRole('group', { name: 'Unsaved changes' }))).toBeVisible()
          await scan(page, 'unsaved-changes prompt')
          await page.getByRole('button', { name: /Discard/ }).click()
          await expect(page.getByRole('dialog')).toBeHidden()

          await page.getByRole('button', { name: /^More actions for Buy oat milk/ }).click()
          await scan(page, 'tile menu')
          await page.getByRole('button', { name: 'Move', exact: true }).click()
          await scan(page, 'move dialog')
          await page.getByRole('button', { name: 'Cancel' }).click()
          await page.getByRole('button', { name: /^More actions for Buy oat milk/ }).click()
          await page.getByRole('button', { name: 'Delete', exact: true }).click()
          await scan(page, 'delete dialog')
          await page.getByRole('button', { name: 'Cancel' }).click()

          await page.getByRole('searchbox', { name: 'Search' }).fill('oat')
          await expect(page.getByRole('list', { name: 'Search results' })).toBeVisible()
          await scan(page, 'search results')
          await page.getByRole('searchbox', { name: 'Search' }).fill('nothing matches this')
          await scan(page, 'search without results')
          await page.getByRole('searchbox', { name: 'Search' }).fill('')

          await openSettings(page)
          await scan(page, 'settings')
          await page.getByRole('button', { name: 'Change passphrase' }).click()
          await expect(page.getByRole('dialog')).toBeVisible()
          await scan(page, 'change passphrase dialog')
          await closeTop(page)
          await openSettings(page)
          await page.getByRole('button', { name: 'Import backup' }).click()
          await expect(page.getByRole('dialog')).toBeVisible()
          await scan(page, 'backup import dialog')
          await closeTop(page)

          await page.reload()
          await expect(page.getByRole('heading', { name: 'Unlock Scratch' })).toBeVisible()
          await scan(page, 'locked')
          await page.getByLabel('Passphrase', { exact: true }).fill('the wrong passphrase')
          await page.getByRole('button', { name: 'Unlock' }).click()
          await expect(page.locator('.form-error, [role="alert"]').first()).toBeVisible({ timeout: 30000 })
          await scan(page, 'locked with a wrong-passphrase error')
          await unlock(page)
        })

        test('error states: failed save and unsupported browser', async ({ page, browser }) => {
          test.slow()
          await createLibrary(page)
          await openAddMenu(page, 'Add note')
          await page.getByRole('textbox', { name: 'Note body' }).fill('Draft that cannot be saved yet')
          await page.evaluate(() => {
            const fail = () => { throw new DOMException('Quota', 'QuotaExceededError') }
            IDBObjectStore.prototype.put = fail
            IDBObjectStore.prototype.add = fail
          })
          await page.getByRole('button', { name: 'Save', exact: true }).click()
          await expect(page.getByRole('alert')).toBeVisible()
          await scan(page, 'editor with a failed save')

          const context = await browser.newContext({ colorScheme, viewport: size.viewport })
          const other = await context.newPage()
          await other.addInitScript(`Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true })`)
          await other.goto('/')
          await expect(other.getByRole('heading', { name: 'Browser not supported' })).toBeVisible()
          await scan(other, 'unsupported browser')
          await context.close()
        })
      })
    }
  }
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('no CSS transition or animation takes time while prefers-reduced-motion is reduce', async ({ page }) => {
    await createLibrary(page)
    await addCollection(page, 'Motion', 'Sage')
    await addNote(page, { body: 'Motion note' })
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)

    async function offenders(): Promise<string[]> {
      return page.evaluate(() => {
        const long = (value: string) => value.split(',').some((part) => parseFloat(part) > 0)
        return [...document.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
          const style = getComputedStyle(element)
          const found: string[] = []
          if (long(style.transitionDuration)) found.push(`transition ${style.transitionDuration}`)
          if (style.animationName !== 'none' && long(style.animationDuration)) found.push(`animation ${style.animationName} ${style.animationDuration}`)
          return found.map((what) => `${element.tagName.toLowerCase()}.${element.className} ${what}`)
        })
      })
    }
    expect(await offenders(), 'home').toEqual([])
    await page.getByRole('link', { name: 'Motion, 0 items' }).hover()
    expect(await offenders(), 'hovered tile').toEqual([])
    await page.getByRole('button', { name: 'Settings' }).hover()
    expect(await offenders(), 'hovered button').toEqual([])
    await openSettings(page)
    expect(await offenders(), 'dialog').toEqual([])
    await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).hover()
    expect(await offenders(), 'hovered dialog control').toEqual([])
  })

  test('sensitivity control: without the preference the same page does animate', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'no-preference' })
    const page = await context.newPage()
    await createLibrary(page)
    await page.getByRole('button', { name: 'Settings' }).hover()
    const duration = await page.getByRole('button', { name: 'Settings' }).evaluate((element) => getComputedStyle(element).transitionDuration)
    expect(parseFloat(duration)).toBeGreaterThan(0)
    await context.close()
  })
})

// Which element has focus, in words a failure message can use.
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    if (!element || element === document.body) return 'body'
    const name = element.getAttribute('aria-label') ?? (element as HTMLInputElement).labels?.[0]?.textContent ?? element.textContent ?? ''
    return `${element.tagName.toLowerCase()}:${name.trim().slice(0, 40)}`
  })
}

// Tabs forward until focus returns to where it started or the limit is reached;
// the list is what a keyboard user visits, in order.
async function tabCycle(page: Page, limit = 40): Promise<string[]> {
  const start = await focused(page)
  const visited = [start]
  for (let index = 0; index < limit; index++) {
    await page.keyboard.press('Tab')
    const here = await focused(page)
    if (here === start) return visited
    visited.push(here)
  }
  throw new Error(`Keyboard trap or runaway focus order: no return to ${start} after ${limit} tabs: ${visited.join(' > ')}`)
}

test.describe('keyboard only', () => {
  test('Add menu: Enter opens, items are reachable, Escape closes and focus returns to Add', async ({ page }) => {
    await createLibrary(page)
    const add = page.getByRole('button', { name: 'Add', exact: true })
    await add.focus()
    await page.keyboard.press('Enter')
    const menu = page.locator('.add-menu')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Tab')
    expect(await focused(page)).toBe('button:Add note')
    await page.keyboard.press('Tab')
    expect(await focused(page)).toBe('button:Add collection')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    expect(await focused(page)).toBe('button:Add')
  })

  test('new note by keyboard: focus lands in the body, Tab stays inside, Escape closes a clean editor and returns to Add', async ({ page }) => {
    await createLibrary(page)
    await page.getByRole('button', { name: 'Add', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'New note' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Note body' })).toBeFocused()
    const order = await tabCycle(page)
    expect(order.length).toBeGreaterThan(2)
    expect(order.every((entry) => entry !== 'body'), `focus never falls to the page: ${order.join(' > ')}`).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(await focused(page)).toBe('button:Add')
  })

  test('a dirty editor asks before Escape closes it, and Keep editing returns focus to the draft', async ({ page }) => {
    await createLibrary(page)
    await openAddMenu(page, 'Add note')
    await page.getByRole('textbox', { name: 'Note body' }).fill('keep me')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('group', { name: 'Unsaved changes' })).toBeVisible()
    await page.getByRole('button', { name: 'Keep editing' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('textbox', { name: 'Note body' })).toBeFocused()
    await expect(page.getByRole('textbox', { name: 'Note body' })).toHaveValue('keep me')
  })

  test('tile menu, move, and delete work by keyboard with Escape and focus return', async ({ page }) => {
    test.slow()
    await createLibrary(page)
    await addCollection(page, 'Target')
    await addNote(page, { body: 'Movable note' })
    // The editor hands focus back to Add a moment after it unmounts; wait for that so the
    // test's own focus is not taken away.
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeFocused()
    const more = page.getByRole('button', { name: 'More actions for Movable note' })
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: /Actions for/ })).toBeVisible()
    expect(await focused(page)).toBe('button:Move')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(more).toBeFocused()

    // Move: choose the destination with arrow keys, confirm with Enter.
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    const move = page.getByRole('dialog', { name: /Move/ })
    await expect(move).toBeVisible()
    const order = await tabCycle(page)
    expect(order.every((entry) => entry !== 'body')).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(more).toBeFocused()

    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.getByRole('radio', { name: /Target/ }).focus()
    await page.keyboard.press('Space')
    await page.getByRole('button', { name: 'Move here' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('link', { name: 'Movable note', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Target, 1 item' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('link', { name: 'Movable note', exact: true })).toBeVisible()

    // Delete: Cancel is the focused default; Escape leaves the note in place.
    await page.getByRole('button', { name: 'More actions for Movable note' }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Delete', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await focused(page)).toBe('button:Cancel')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('link', { name: 'Movable note', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'More actions for Movable note' })).toBeFocused()
  })

  test('search by keyboard: type, reach the results, clear with the keyboard', async ({ page }) => {
    await createLibrary(page)
    await addNote(page, { body: 'Findable pear note' })
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeFocused()
    await page.getByRole('searchbox', { name: 'Search' }).focus()
    await page.keyboard.type('pear')
    await expect(page.getByRole('list', { name: 'Search results' })).toBeVisible()
    await page.keyboard.press('Tab')
    const next = await focused(page)
    expect(next, 'Tab from the search box moves into the results or controls, not the hidden page').not.toBe('body')
    // The hidden library grid is inert while results show, so no focus stop is in it.
    expect(await page.evaluate(() => document.activeElement?.closest('[inert]') === null)).toBe(true)
    const order = await tabCycle(page)
    expect(order.length).toBeGreaterThan(0)
    await page.getByRole('searchbox', { name: 'Search' }).focus()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    await expect(page.getByRole('list', { name: 'Search results' })).toHaveCount(0)
  })

  test('lock by keyboard: Settings, Lock now, focus lands in the unlock form, and unlocking is keyboard-only', async ({ page }) => {
    await createLibrary(page)
    await page.getByRole('button', { name: 'Settings' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    const order = await tabCycle(page)
    expect(order.every((entry) => entry !== 'body'), order.join(' > ')).toBe(true)
    await page.getByRole('button', { name: 'Lock now' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Unlock Scratch' })).toBeVisible()
    await page.keyboard.type(PASSPHRASE)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible({ timeout: 30000 })
  })

  test('backup dialogs by keyboard: Escape closes them and no key press is trapped', async ({ page }) => {
    await createLibrary(page)
    await page.getByRole('button', { name: 'Settings' }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Import backup' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    const order = await tabCycle(page)
    expect(order.every((entry) => entry !== 'body'), order.join(' > ')).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    // Focus must be somewhere a keyboard user can continue from, not lost.
    const where = await focused(page)
    expect(where, 'focus after closing the import dialog').not.toBe('body')
  })

  test('the page itself has a complete focus order with no trap', async ({ page, browserName }) => {
    await createLibrary(page)
    await addCollection(page, 'Order')
    await addNote(page, { body: 'Order note' })
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeFocused()
    await page.locator('body').click({ position: { x: 1, y: 1 } })
    await page.keyboard.press('Tab')
    const order = await tabCycle(page, 60)
    expect(order).toContain('button:Add')
    expect(order).toContain('button:Settings')
    // Tiles are links. Safari and its WebKit port skip links when Tab is pressed unless the
    // person turns on "Press Tab to highlight each item" (Option+Tab otherwise), so this
    // part is asserted on the other engines; every tile also has Copy and menu buttons.
    if (browserName !== 'webkit') expect(order.some((entry) => entry.startsWith('a:Order'))).toBe(true)
  })
})

test.describe('palette', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`native radios and checkboxes use the action color, not the browser blue (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await createLibrary(page)
      await openAddMenu(page, 'Add note')
      const accent = (selector: string) => page.locator(selector).first().evaluate((element) => ({ own: getComputedStyle(element).accentColor, action: (() => { const probe = document.createElement('span'); probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--action'); document.body.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value })() }))
      const checkbox = await accent('.editor-secret input[type="checkbox"]')
      expect(checkbox.own).toBe(checkbox.action)
      await page.keyboard.press('Escape')
      await openSettings(page)
      const radio = await accent('input[type="radio"]')
      expect(radio.own).toBe(radio.action)
    })
  }
})
