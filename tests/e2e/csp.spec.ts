import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { readHeaderBlock } from '../../config/headers'
import { addCollection, addNote, createLibrary, exportBackup, openSettings, SYNTHETIC_TOKEN, unlock, waitForControl } from './helpers'

// The production preview answers with the Content Security Policy from
// public/_headers (see vite.config.ts). This run drives the real app under that policy
// and fails on any violation: no inline script or style, no blocked font, worker,
// icon, download, or request. The page and the service worker both have to work.

const policy = readHeaderBlock(resolve(process.cwd(), 'public/_headers'), '/*')

test('the preview serves the policy from public/_headers on the page and on the worker script', async ({ request }) => {
  expect(policy['Content-Security-Policy']).toMatch(/script-src 'self'/)
  for (const path of ['/', '/index.html', '/sw.js', '/theme-init.js', '/assets/']) {
    const response = await request.get(path)
    expect(response.headers()['content-security-policy'], `CSP header on ${path}`).toBe(policy['Content-Security-Policy'])
  }
})

test('the whole app runs under the policy with no violation, and the policy really blocks', async ({ page, context, browserName }, testInfo) => {
  test.slow()
  const violations: string[] = []
  const consoleProblems: string[] = []
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      ;((window as unknown as { __cspLog?: string[] }).__cspLog ??= []).push(`${event.violatedDirective} blocked ${event.blockedURI || 'inline'}`)
    })
  })
  const collect = async () => violations.push(...(await page.evaluate(() => (window as unknown as { __cspLog?: string[] }).__cspLog ?? [])))
  page.on('console', (message) => { if (/content security policy|refused to|violates/i.test(message.text())) consoleProblems.push(message.text()) })
  page.on('pageerror', (error) => consoleProblems.push(error.message))

  await createLibrary(page)
  await waitForControl(page)
  await addCollection(page, 'Policy', 'Sage')
  await page.getByRole('link', { name: 'Policy, 0 items' }).click()
  await addNote(page, { body: SYNTHETIC_TOKEN, title: 'Key', secret: true })
  await addNote(page, { body: 'Plain note' })
  await page.getByRole('link', { name: 'Key, secret note' }).click()
  await page.getByRole('button', { name: 'Reveal' }).click()
  await expect(page.getByRole('dialog').locator('pre')).toHaveText(SYNTHETIC_TOKEN)
  await page.getByRole('button', { name: 'Close' }).first().click()
  await page.getByRole('button', { name: /^More actions for Plain note/ }).click()
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('searchbox', { name: 'Search' }).fill('plain')
  await expect(page.getByRole('list', { name: 'Search results' })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search' }).fill('')
  await exportBackup(page, testInfo, 'csp.scratch')
  await openSettings(page)
  await page.getByRole('button', { name: 'Import backup' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await unlock(page)
  // Fonts load lazily; ask the browser to finish loading every one it uses.
  await page.evaluate(() => document.fonts.ready)
  await collect()
  expect(violations, 'securitypolicyviolation events').toEqual([])
  expect(consoleProblems, 'console messages about the policy').toEqual([])

  // The built page itself carries no inline script, inline handler, or style attribute.
  const html = await page.evaluate(() => document.documentElement.outerHTML)
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i)
  expect(html).not.toMatch(/\son[a-z]+=/i)
  expect(html).not.toMatch(/<style[\s>]/i)

  // Sensitivity control: with the same listener, an inline script and an inline style
  // attribute really are refused, so the empty list above is not a blind spot.
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.inlineRan = true'
    document.head.append(script)
    const probe = document.createElement('div')
    probe.setAttribute('style', 'color: red')
    document.body.append(probe)
  })
  expect(await page.evaluate(() => (window as unknown as { inlineRan?: boolean }).inlineRan)).toBeUndefined()
  await collect()
  expect(violations.some((entry) => entry.startsWith('script-src')), `inline script refused (${browserName})`).toBe(true)
  expect(violations.some((entry) => entry.startsWith('style-src')), `inline style refused (${browserName})`).toBe(true)

  // A request to another origin is refused by connect-src, never sent.
  const outcome = await page.evaluate(() => fetch('https://example.invalid/collect', { method: 'POST', body: 'x' }).then(() => 'sent', () => 'blocked'))
  expect(outcome).toBe('blocked')
  await context.close()
})

test('the shipped build has no inline script and the policy has not been weakened', async () => {
  const html = await readFile(resolve(process.cwd(), 'dist/index.html'), 'utf8')
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i)
  const built = readHeaderBlock(resolve(process.cwd(), 'dist/_headers'), '/*')
  expect(built['Content-Security-Policy']).toBe(policy['Content-Security-Policy'])
})
