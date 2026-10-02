import { expect, test, type Page } from '@playwright/test'
import { addCollection, addNote, createLibrary, horizontalOverflow, openAddMenu, openSettings, PASSPHRASE, SYNTHETIC_TOKEN } from './helpers'

// Layout and target-size contract of the design brief: no horizontal page scrolling at
// 320 px and at 200% zoom, and every core action reachable and at least 44 px. Zoom
// is emulated the way layout sees it: 200% of a 1280 px window is a 640 px viewport
// (device pixel ratio 2), 400% is 320 px. Real browser zoom and OS text size are not
// scriptable here and are listed as manual checks in the verification notes.

// Every visible control must sit inside the viewport horizontally, and the page must
// not scroll sideways. Visually hidden helpers (1 px clipped boxes) are ignored.
async function expectFits(page: Page, where: string) {
  expect(await horizontalOverflow(page), `${where}: page scrolls horizontally`).toBeLessThanOrEqual(0)
  const stray = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    return [...document.querySelectorAll<HTMLElement>('button, a[href], input, textarea, [role="dialog"], h1, h2, h3')]
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return box.width > 1 && box.height > 1 && getComputedStyle(element).visibility !== 'hidden'
      })
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return box.left < -0.5 || box.right > width + 0.5
      })
      .map((element) => `${element.tagName.toLowerCase()} ${(element.getAttribute('aria-label') ?? element.textContent ?? '').slice(0, 30)}`)
  })
  expect(stray, `${where}: controls outside the viewport`).toEqual([])
}

async function expectBottomReachable(page: Page, name: string, where: string) {
  const box = await page.getByRole('button', { name, exact: true }).boundingBox()
  const height = page.viewportSize()!.height
  expect(box && box.y >= 0 && box.y + box.height <= height + 0.5, `${where}: ${name} is inside the viewport`).toBe(true)
}

// 40 stacked-accent letters, five family emoji (ZWJ sequences), and 20 ring-accented
// capitals with no space anywhere: 65 grapheme clusters, 385 bytes, nothing to wrap at.
const LONG_UNICODE_TITLE = 'ẹ́'.repeat(40) + '👨‍👩‍👧‍👦'.repeat(5) + 'Å'.repeat(20)

async function walk(page: Page, label: string) {
  await expectFits(page, `${label} setup`)
  await createLibrary(page)
  await expectFits(page, `${label} empty home`)
  await addCollection(page, 'A collection with a deliberately long title to force wrapping', 'Ochre')
  await page.getByRole('link', { name: /A collection with a deliberately/ }).click()
  await expectFits(page, `${label} empty collection`)
  await addNote(page, { body: SYNTHETIC_TOKEN, title: 'OpenAI key for the long title wrapping check', secret: true })
  await addNote(page, { body: 'A note whose first line is long enough to need wrapping on a small screen\nsecond line' })
  await expectFits(page, `${label} collection`)

  await addNote(page, { body: 'Unicode title body', title: LONG_UNICODE_TITLE })
  await expectFits(page, `${label} collection with a long unbroken Unicode title`)
  await page.locator('a.tile-link').filter({ hasText: '👨' }).click()
  await expectFits(page, `${label} reader with a long unbroken Unicode title`)
  await page.getByRole('button', { name: 'Close' }).first().click()
  await expect(page.getByRole('dialog')).toBeHidden()

  await page.getByRole('link', { name: 'OpenAI key for the long title wrapping check, secret note' }).click()
  await expectFits(page, `${label} reader`)
  await page.getByRole('button', { name: 'Reveal' }).click()
  await expectFits(page, `${label} revealed secret`)
  await page.getByRole('button', { name: 'Edit secret' }).click()
  await expectFits(page, `${label} editor`)
  await expectBottomReachable(page, 'Save', `${label} editor`)
  await expectBottomReachable(page, 'Cancel', `${label} editor`)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: /^More actions for A note whose/ }).click()
  await expectFits(page, `${label} item menu`)
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  await expectFits(page, `${label} move dialog`)
  await expectBottomReachable(page, 'Move here', `${label} move dialog`)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('searchbox', { name: 'Search' }).fill('wrapping')
  await expectFits(page, `${label} search results`)
  await page.getByRole('searchbox', { name: 'Search' }).fill('no such text anywhere')
  await expectFits(page, `${label} empty search`)
  await page.getByRole('searchbox', { name: 'Search' }).fill('')

  await openAddMenu(page, 'Add collection')
  await expectFits(page, `${label} collection dialog`)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await openSettings(page)
  await expectFits(page, `${label} settings`)
  await page.getByRole('button', { name: 'Import backup' }).click()
  await expectFits(page, `${label} import dialog`)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.reload()
  await expectFits(page, `${label} unlock`)
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible({ timeout: 30000 })
}

for (const size of [
  { label: '320 px width', width: 320, height: 568, scale: 2 },
  { label: '200% zoom (640 px layout width)', width: 640, height: 360, scale: 2 },
]) {
  test.describe(size.label, () => {
    test.use({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale })

    // The slow walks run once per engine pair, on the desktop projects: the phone
    // projects already fix the viewport at 360 px, and each walk repeats several 600,000
    // iteration key derivations.
    test('no horizontal scrolling on any screen and every core action stays reachable', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.startsWith('mobile'), 'Walked on the desktop project of the same engine.')
      test.slow()
      await walk(page, size.label)
    })
  })
}

test('primary controls are at least 44 px tall and wide at this project width', async ({ page }) => {
  await createLibrary(page)
  await addCollection(page, 'Targets')
  await addNote(page, { body: 'Target size note' })
  const small: string[] = []
  async function measure(name: string, locator: ReturnType<Page['locator']>, axes: 'both' | 'height' = 'both', minimum = 44) {
    const box = await locator.first().boundingBox()
    if (!box) { small.push(`${name}: not found`); return }
    if (box.height < minimum - 0.5 || (axes === 'both' && box.width < minimum - 0.5)) small.push(`${name}: ${Math.round(box.width)}x${Math.round(box.height)}`)
  }
  await measure('wordmark', page.getByRole('link', { name: 'Scratch home' }), 'height')
  await measure('search', page.getByRole('searchbox', { name: 'Search' }), 'height')
  await measure('New note', page.getByRole('button', { name: 'New note', exact: true }))
  await measure('Settings', page.getByRole('button', { name: 'Settings' }))
  await measure('collection tile', page.getByRole('link', { name: 'Targets, 0 items' }))
  await measure('note tile', page.getByRole('link', { name: 'Target size note', exact: true }))
  // The small in-tile actions are held to 32 px, above the WCAG 2.2 AA minimum of 24 px.
  await measure('Copy', page.getByRole('button', { name: 'Copy Target size note' }), 'both', 32)
  await measure('Edit', page.getByRole('button', { name: 'Edit Target size note' }), 'both', 32)
  await measure('note menu', page.getByRole('button', { name: 'More actions for Target size note' }), 'both', 32)
  await openAddMenu(page, 'Add note')
  await measure('Save', page.getByRole('button', { name: 'Save', exact: true }))
  await measure('Cancel', page.getByRole('button', { name: 'Cancel' }))
  await measure('Add title', page.getByRole('button', { name: 'Add title' }), 'height')
  await measure('secret checkbox row', page.locator('.editor-secret label'), 'height')
  await measure('close dialog', page.getByRole('button', { name: 'Close dialog' }), 'both', 32)
  expect(small, 'targets below 44 px').toEqual([])
})

test('the first-visit offline notice never covers a visible control', async ({ page }) => {
  await createLibrary(page)
  const notice = page.locator('.update-status')
  await expect(notice).toBeVisible({ timeout: 15000 })
  const overlaps = await page.evaluate(() => {
    const status = document.querySelector('.update-status')!.getBoundingClientRect()
    return [...document.querySelectorAll<HTMLElement>('button, a[href], input, textarea')]
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return box.width > 1 && box.height > 1 && getComputedStyle(element).visibility !== 'hidden'
      })
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return box.left < status.right && box.right > status.left && box.top < status.bottom && box.bottom > status.top
      })
      .map((element) => `${element.tagName.toLowerCase()} ${(element.getAttribute('aria-label') ?? element.textContent ?? '').slice(0, 30)}`)
  })
  expect(overlaps, 'controls under the offline notice').toEqual([])
  const add = await page.getByRole('button', { name: 'New note', exact: true }).boundingBox()
  const box = await notice.boundingBox()
  expect(add && box && !(add.x < box.x + box.width && add.x + add.width > box.x && add.y < box.y + box.height && add.y + add.height > box.y), 'Add stays clear of the notice').toBe(true)
})
