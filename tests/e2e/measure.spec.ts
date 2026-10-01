import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cpus, platform, release, totalmem } from 'node:os'
import { expect, test } from '@playwright/test'
import { createLibrary, importBackupOnSetup, PASSPHRASE } from './helpers'

// Measurement run, not a regression test: runs only with MEASURE=1 after
// `MEASURE=1 npx vitest run tests/measure` has written the 1,000-item backup. It times
// unlock (with the real 600,000-iteration key derivation), import, warm navigation,
// and search in desktop Chromium, in the page, from the input or click event to the
// frame in which the result is on screen. Results go to measure-output/browser.json.
// This is a desktop browser on this machine; it says nothing certain about a phone.

const OUT = resolve(process.cwd(), 'measure-output')
const BACKUP = resolve(OUT, 'thousand.scratch')

const round = (value: number) => Math.round(value * 10) / 10
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
  return { runs: values.length, min: round(sorted[0]), median: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1]) }
}

type Hooks = {
  __t: { click?: number, shown?: number }
  __nav: (action: () => void) => Promise<number>
  __search: (query: string) => Promise<{ ms: number, status: string }>
}

test('unlock, import, warm navigation, and search with 1,000 items', async ({ page, browser }, testInfo) => {
  test.skip(process.env.MEASURE !== '1', 'Set MEASURE=1 to run the measurements.')
  test.setTimeout(300000)
  const result: Record<string, unknown> = {
    environment: {
      cpu: `${cpus()[0].model.trim()} x${cpus().length}`,
      memoryGiB: Math.round(totalmem() / 2 ** 30),
      os: `${platform()} ${release()}`,
      browser: `${testInfo.project.name} ${browser.version()}`,
      node: process.version,
    },
  }

  // Unlock: a small library, because the key derivation dominates; repeated.
  await createLibrary(page)
  const unlockTimes: number[] = []
  for (let run = 0; run < 7; run++) {
    await page.reload()
    await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
    await page.evaluate(() => {
      const w = window as unknown as Hooks
      w.__t = {}
      document.addEventListener('click', () => { w.__t.click = performance.now() }, { capture: true, once: true })
      new MutationObserver((_records, observer) => {
        if ([...document.querySelectorAll('button')].some((button) => (button.textContent ?? '').trim().endsWith('Add'))) {
          requestAnimationFrame(() => { w.__t.shown = performance.now() })
          observer.disconnect()
        }
      }).observe(document.body, { childList: true, subtree: true })
    })
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible({ timeout: 30000 })
    await page.waitForFunction(() => (window as unknown as Hooks).__t.shown !== undefined)
    const t = await page.evaluate(() => (window as unknown as Hooks).__t)
    unlockTimes.push(t.shown! - t.click!)
  }
  result.unlockMs = { ...stats(unlockTimes), note: 'click on Unlock to the Add button on screen; 600,000 PBKDF2 iterations; 7 runs' }

  // 1,000-item library through the real import path, in a fresh context.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true })
  const big = await context.newPage()
  const importStart = Date.now()
  await importBackupOnSetup(big, BACKUP, 1000)
  result.importMs = { value: Date.now() - importStart, note: 'wall clock from opening setup to the library on screen: key derivation, decrypting and validating 1,000 items, writing them; Playwright round trips included' }

  await big.evaluate(() => {
    ;(window as unknown as Hooks).__nav = (action) => new Promise((resolveNav) => {
      const t0 = performance.now()
      const root = document.querySelector('main') as HTMLElement
      const before = root.innerText
      const observer = new MutationObserver(() => {
        if (root.innerText !== before) {
          observer.disconnect()
          requestAnimationFrame(() => requestAnimationFrame(() => resolveNav(performance.now() - t0)))
        }
      })
      observer.observe(root, { childList: true, subtree: true, characterData: true })
      action()
    })
  })
  // Warm navigation: open each of the 20 collections (49 items each) and go back.
  const navMs: number[] = []
  for (let c = 1; c <= 20; c++) {
    await expect(big.getByRole('link', { name: new RegExp(`^Collection ${c} .*, 49 items$`) })).toBeVisible()
    navMs.push(await big.evaluate((index) => (window as unknown as Hooks).__nav(() => {
      const anchor = [...document.querySelectorAll<HTMLAnchorElement>('a.tile-link')].find((candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent ?? '').startsWith(`Collection ${index} `))
      anchor!.click()
    }), c))
    navMs.push(await big.evaluate(() => (window as unknown as Hooks).__nav(() => history.back())))
  }
  result.warmNavigationMs = { ...stats(navMs), note: '1,000-item library unlocked; click a collection tile or press Back until the new grid is painted (two frames); 20 opens and 20 Backs' }

  // Search: typing a query to the matching list painted, the 150 ms debounce included.
  await big.evaluate(() => {
    ;(window as unknown as Hooks).__search = (query) => new Promise((resolveSearch) => {
      const input = document.querySelector('input[type="search"]') as HTMLInputElement
      const status = document.querySelector('p[role="status"]') as HTMLElement
      const before = status.textContent
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      const t0 = performance.now()
      const observer = new MutationObserver(() => {
        if (status.textContent !== before) {
          observer.disconnect()
          requestAnimationFrame(() => requestAnimationFrame(() => resolveSearch({ ms: performance.now() - t0, status: status.textContent ?? '' })))
        }
      })
      observer.observe(status, { childList: true, characterData: true, subtree: true })
      setter.call(input, query)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  })
  const perQuery: Record<string, { debounceIncludedMs: number, afterDebounceMs: number, status: string }> = {}
  const all: number[] = []
  for (const query of ['river', 'second line about router 9', 'zzzz no match', 'Key 4', 'a']) {
    const times: number[] = []
    let status = ''
    for (let run = 0; run < 5; run++) {
      const found = await big.evaluate((q) => (window as unknown as Hooks).__search(q), query)
      times.push(found.ms)
      status = found.status
      await big.getByRole('searchbox', { name: 'Search' }).fill('')
      await big.waitForTimeout(400)
    }
    const median = stats(times).median
    perQuery[query] = { debounceIncludedMs: median, afterDebounceMs: round(median - 150), status }
    all.push(...times)
  }
  result.searchMs = { perQuery, overall: stats(all), note: 'input event to results painted (two frames); the 150 ms debounce is inside debounceIncludedMs; 5 runs per query, median reported' }
  await context.close()

  mkdirSync(OUT, { recursive: true })
  writeFileSync(resolve(OUT, 'browser.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
})
