import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, type BrowserContext, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test'

// Shared steps for the browser specs. Every value here is a synthetic fixture:
// nothing is a real credential, and the library is always built through the UI.

export const PASSPHRASE = 'correct horse battery staple'
// Looks like an API key but is not one. Distinctive so a leak is easy to find.
export const SYNTHETIC_TOKEN = 'sk-proj-SYNTHETIC0example0not0a0real0token0Zq7'

export async function waitForControl(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20000 })
}

export async function createLibrary(page: Page, entry = '/') {
  await page.goto(entry)
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await page.getByLabel('Confirm passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Create vault' }).click()
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible({ timeout: 30000 })
}

export async function unlock(page: Page) {
  await expect(page.getByRole('heading', { name: 'Unlock Scratch' })).toBeVisible()
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible({ timeout: 30000 })
}

export async function openAddMenu(page: Page, choice: 'Add note' | 'Add collection') {
  await page.getByRole('button', { name: choice === 'Add note' ? 'New note' : 'New collection', exact: true }).click()
}

export interface NoteInput { body: string, title?: string, secret?: boolean }

export async function fillEditor(page: Page, note: NoteInput) {
  await page.getByRole('textbox', { name: 'Note body' }).fill(note.body)
  if (note.title !== undefined) {
    await page.getByRole('button', { name: 'Add title' }).click()
    await page.getByLabel('Title', { exact: true }).fill(note.title)
  }
  if (note.secret) await page.getByRole('checkbox', { name: 'Secret note' }).check()
}

// + Note, type, optionally title and secret, Save.
export async function addNote(page: Page, note: NoteInput) {
  await openAddMenu(page, 'Add note')
  await fillEditor(page, note)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

export async function addCollection(page: Page, title: string, color?: 'Sage' | 'Clay' | 'Ochre' | 'Slate') {
  await openAddMenu(page, 'Add collection')
  const dialog = page.getByRole('dialog', { name: 'New collection' })
  await dialog.getByLabel('Title').fill(title)
  if (color) await dialog.getByRole('button', { name: color }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

export async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}

// Exports through the real Settings control and a real download.
export async function exportBackup(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  await openSettings(page)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export backup' }).click()
  const download = await downloading
  const path = testInfo.outputPath(name)
  await download.saveAs(path)
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close dialog' }).click()
  return path
}

// First-use import on a browser that has no library yet.
export async function importBackupOnSetup(page: Page, path: string, expectedItems: number) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Set up Scratch' })).toBeVisible()
  await page.getByRole('button', { name: 'Import backup' }).click()
  await page.getByLabel('Backup file').setInputFiles(path)
  await page.getByLabel('Backup passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Review backup' }).click()
  await expect(page.getByText(`This backup contains ${expectedItems} ${expectedItems === 1 ? 'item' : 'items'}.`)).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Import library' }).click()
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible({ timeout: 30000 })
}

export interface RecordedRequest { url: string, method: string, postData: string | null, fromServiceWorker: boolean }

// Records every request any page or worker in the context makes, with its body.
export function recordRequests(context: BrowserContext): RecordedRequest[] {
  const seen: RecordedRequest[] = []
  context.on('request', (request) => {
    let fromServiceWorker = false
    try { fromServiceWorker = request.serviceWorker() !== null } catch { /* Not supported by this engine. */ }
    seen.push({ url: request.url(), method: request.method(), postData: request.postData(), fromServiceWorker })
  })
  return seen
}

// The page's horizontal overflow in CSS pixels; zero or negative means none.
export function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

// A second browser context with the same device shape as the project but its own,
// empty storage: what moving to another browser or device looks like.
export function independentContextOptions(testInfo: TestInfo): BrowserContextOptions {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = testInfo.project.use
  return { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, acceptDownloads: true }
}

// A pass-through server in front of the preview build. Bumping the version appends
// a comment to the worker script, which is what a new deployment looks like to the
// browser: a different script that installs and then waits for approval.
export async function startUpdatableHost(origin: string) {
  let version = 1
  const server: Server = createServer((request, response) => {
    void (async () => {
      const upstream = await fetch(new URL(request.url ?? '/', origin))
      let body = Buffer.from(await upstream.arrayBuffer())
      if (request.url === '/sw.js') body = Buffer.concat([body, Buffer.from(`
// version ${version}
`)])
      // The policy and companion headers pass through, so offline and update runs happen
      // under the same Content Security Policy the preview applies.
      const passed: Record<string, string> = {}
      for (const name of ['content-security-policy', 'x-content-type-options', 'referrer-policy']) {
        const value = upstream.headers.get(name)
        if (value) passed[name] = value
      }
      response.writeHead(upstream.status, { ...passed, 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store' })
      response.end(body)
    })().catch(() => { response.writeHead(502); response.end() })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://localhost:${(server.address() as AddressInfo).port}/`
  return { url, bump: () => { version += 1 }, close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }) }
}
