import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { addNote, createLibrary, exportBackup, PASSPHRASE, recordRequests, SYNTHETIC_TOKEN, unlock } from './helpers'

// Secret-specific checks across everything a person, a script, or a network
// observer could read: text, accessible names, attributes, URLs, browser storage,
// exports, clipboard failures, console output, and requests. All values are
// synthetic fixtures. Reveal is the one deliberate place the token may be on screen.

const TITLE = 'OpenAI production key'
const ORDINARY = 'ordinary note marker 7731'
// btoa(SYNTHETIC_TOKEN) assertions were removed: base64 of a substring depends on byte alignment, so they were near-vacuous, and the raw-byte scanner already covers the ciphertext.
const SENSITIVE = [SYNTHETIC_TOKEN, TITLE, ORDINARY, PASSPHRASE]

// Every string the page exposes: text, accessibility snapshot, attribute values, title.
async function exposed(page: Page): Promise<string> {
  const attributes = await page.evaluate(() => [
    document.title,
    ...[...document.querySelectorAll('*')].flatMap((element) => [...element.attributes].map((attribute) => `${attribute.name}=${attribute.value}`)),
  ].join('\n'))
  return [await page.locator('body').innerText(), await page.locator('body').ariaSnapshot(), attributes, page.url()].join('\n')
}

// Raw browser storage as one searchable string: localStorage, sessionStorage, every
// IndexedDB record (strings, and bytes as latin1 and base64), and every Cache entry.
async function rawStorage(page: Page): Promise<{ text: string, records: number, databases: number }> {
  return page.evaluate(async () => {
    const parts: string[] = []
    let records = 0
    const bytesToText = (bytes: Uint8Array) => {
      let latin1 = ''
      for (const byte of bytes) latin1 += String.fromCharCode(byte)
      return `${latin1}\n${btoa(latin1)}`
    }
    const walk = (value: unknown, seen = new Set<unknown>()): void => {
      if (value === null || typeof value !== 'object') { parts.push(String(value)); return }
      if (seen.has(value)) return
      seen.add(value)
      if (value instanceof ArrayBuffer) { parts.push(bytesToText(new Uint8Array(value))); return }
      if (ArrayBuffer.isView(value)) { parts.push(bytesToText(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))); return }
      for (const [key, inner] of Object.entries(value)) { parts.push(key); walk(inner, seen) }
    }
    for (const store of [localStorage, sessionStorage]) {
      for (let index = 0; index < store.length; index++) {
        const key = store.key(index)!
        parts.push(key, store.getItem(key) ?? '')
      }
    }
    const databases = await indexedDB.databases()
    for (const info of databases) {
      const db = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
        const request = indexedDB.open(info.name!)
        request.onsuccess = () => resolveOpen(request.result)
        request.onerror = () => rejectOpen(request.error)
      })
      parts.push(db.name)
      for (const name of db.objectStoreNames) {
        parts.push(name)
        const rows = await new Promise<unknown[]>((resolveAll, rejectAll) => {
          const request = db.transaction(name).objectStore(name).getAll()
          request.onsuccess = () => resolveAll(request.result)
          request.onerror = () => rejectAll(request.error)
        })
        const keys = await new Promise<unknown[]>((resolveKeys, rejectKeys) => {
          const request = db.transaction(name).objectStore(name).getAllKeys()
          request.onsuccess = () => resolveKeys(request.result)
          request.onerror = () => rejectKeys(request.error)
        })
        records += rows.length
        keys.forEach((key) => walk(key))
        rows.forEach((row) => walk(row))
      }
      db.close()
    }
    for (const name of await caches.keys()) {
      parts.push(name)
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        parts.push(request.url)
        const response = await cache.match(request)
        const type = response?.headers.get('content-type') ?? ''
        if (!/font|image/.test(type)) parts.push(await response!.text())
      }
    }
    return { text: parts.join('\n'), records, databases: databases.length }
  })
}

function expectNoneOf(haystack: string, needles: string[], where: string) {
  for (const needle of needles) expect(haystack, `${where} must not contain ${needle === PASSPHRASE ? 'the passphrase' : JSON.stringify(needle)}`).not.toContain(needle)
}

test('the storage scanner finds a plain marker it should find (sensitivity control)', async ({ page }) => {
  await page.goto('/licenses/public-sans-OFL.txt')
  await page.evaluate(async () => {
    localStorage.setItem('probe', 'marker-in-local')
    sessionStorage.setItem('probe', 'marker-in-session')
    await new Promise<void>((done, fail) => {
      const open = indexedDB.open('probe-db')
      open.onupgradeneeded = () => open.result.createObjectStore('rows')
      open.onsuccess = () => {
        const tx = open.result.transaction('rows', 'readwrite')
        tx.objectStore('rows').put({ bytes: new TextEncoder().encode('marker-in-bytes') }, 'k')
        tx.oncomplete = () => { open.result.close(); done() }
        tx.onerror = () => fail(tx.error)
      }
    })
    const cache = await caches.open('probe-cache')
    await cache.put('/probe.txt', new Response('marker-in-cache', { headers: { 'content-type': 'text/plain' } }))
  })
  const found = await rawStorage(page)
  for (const marker of ['marker-in-local', 'marker-in-session', 'marker-in-bytes', 'marker-in-cache']) expect(found.text).toContain(marker)
})

test('a secret note stays out of text, names, URLs, storage, exports, clipboard errors, console, and the network', async ({ context, page, browserName }, testInfo) => {
  test.slow()
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const requests = recordRequests(context)
  const consoleLines: string[] = []
  page.on('console', (message) => consoleLines.push(message.text()))
  page.on('pageerror', (error) => consoleLines.push(error.message))
  const visited: string[] = []

  await test.step('capture a titled secret and an ordinary note through the UI', async () => {
    await createLibrary(page)
    await addNote(page, { body: SYNTHETIC_TOKEN, title: TITLE, secret: true })
    await addNote(page, { body: ORDINARY })
    visited.push(page.url())
  })

  await test.step('after load, note operations make no network request at all', async () => {
    const before = requests.length
    await addNote(page, { body: 'one more local note' })
    await page.getByRole('searchbox', { name: 'Search' }).fill('one more')
    await expect(page.getByRole('link', { name: 'one more local note', exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search' }).fill('')
    expect(requests.slice(before).map((request) => request.url)).toEqual([])
  })

  await test.step('lists and tiles show the title and a mask, never the token', async () => {
    const everything = await exposed(page)
    expect(everything).not.toContain(SYNTHETIC_TOKEN)
    await expect(page.getByRole('link', { name: `${TITLE}, secret note` })).toBeVisible()
    await expect(page.locator('.note-tile[data-secret] .tile-secret')).toHaveText('••••••••')
    // The mask is decoration; assistive technology gets the title and the secret flag only.
    await expect(page.locator('.note-tile[data-secret] .tile-secret')).toHaveAttribute('aria-hidden', 'true')
  })

  await test.step('the reader is masked until Reveal, then hides again', async () => {
    await page.getByRole('link', { name: `${TITLE}, secret note` }).click()
    const reader = page.getByRole('dialog', { name: 'Note' })
    await expect(reader.getByText('Secret content is hidden.')).toBeAttached()
    expectNoneOf(await exposed(page), [SYNTHETIC_TOKEN], 'masked reader')
    await reader.getByRole('button', { name: 'Reveal' }).click()
    await expect(reader.locator('pre')).toHaveText(SYNTHETIC_TOKEN)
    // Positive control: the same scanner that must find nothing elsewhere does see the
    // token here, so the "not exposed" checks cannot pass merely because it is blind.
    expect(await exposed(page), 'exposed() detects the token while it is revealed').toContain(SYNTHETIC_TOKEN)
    await reader.getByRole('button', { name: 'Hide' }).click()
    await expect(reader.locator('pre')).toHaveCount(0)
    expectNoneOf(await exposed(page), [SYNTHETIC_TOKEN], 'hidden again')
    visited.push(page.url())
    await reader.getByRole('button', { name: 'Edit secret' }).click()
    // The editor is the one input that holds the value; it opts out of spell check and autofill.
    const body = page.getByRole('textbox', { name: 'Note body' })
    await expect(body).toHaveValue(SYNTHETIC_TOKEN)
    expect(await body.evaluate((element: HTMLTextAreaElement) => element.spellcheck)).toBe(false)
    await expect(body).toHaveAttribute('autocomplete', 'off')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  await test.step('search never matches or shows a secret body and keeps terms out of the address', async () => {
    const search = page.getByRole('searchbox', { name: 'Search' })
    await search.fill(SYNTHETIC_TOKEN)
    await expect(page.getByRole('region', { name: 'Search results' }).getByText('No matches')).toBeVisible()
    visited.push(page.url())
    expectNoneOf(await page.getByRole('main').innerText(), [SYNTHETIC_TOKEN], 'search results')
    await search.fill('production')
    await expect(page.getByRole('link', { name: `${TITLE}, secret note, in scratch` })).toBeVisible()
    visited.push(page.url())
    await search.fill('')
  })

  await test.step('a successful copy announces only Copied', async () => {
    await page.getByRole('button', { name: `Copy ${TITLE}` }).click()
    await expect(page.getByText('Copied', { exact: true })).toBeVisible()
    const statuses = await page.getByRole('status').allInnerTexts()
    expectNoneOf(statuses.join('\n'), SENSITIVE, 'status regions')
    if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SYNTHETIC_TOKEN)
  })

  await test.step('a refused clipboard write shows a safe error and exposes nothing', async () => {
    await page.evaluate(() => {
      Clipboard.prototype.writeText = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
    })
    await page.getByRole('button', { name: `Copy ${TITLE}` }).click()
    await expect(page.getByText('Could not copy.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reveal to copy manually' })).toBeVisible()
    await expect(page.getByText('Copied', { exact: true })).toHaveCount(0)
    expectNoneOf(await exposed(page), [SYNTHETIC_TOKEN], 'copy failure')
    await page.getByRole('button', { name: 'Copy one more local note' }).click()
    await expect(page.getByText('Could not copy.').first()).toBeVisible()
  })

  let storage = await rawStorage(page)
  await test.step('raw storage while unlocked holds no readable content', async () => {
    // A real, populated database: the scan is not passing because it found nothing.
    expect(storage.databases).toBeGreaterThanOrEqual(1)
    expect(storage.records).toBeGreaterThanOrEqual(4)
    expectNoneOf(storage.text, SENSITIVE, 'IndexedDB, Cache, localStorage, sessionStorage')
  })

  await test.step('a reload locks, shows no content, and storage still holds none', async () => {
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Unlock Scratch' })).toBeVisible()
    expectNoneOf(await exposed(page), SENSITIVE, 'locked screen')
    storage = await rawStorage(page)
    expectNoneOf(storage.text, SENSITIVE, 'storage while locked')
    await unlock(page)
  })

  await test.step('the exported backup holds no readable content', async () => {
    const path = await exportBackup(page, testInfo, 'secrets.scratch')
    const text = await readFile(path, 'utf8')
    expectNoneOf(text, SENSITIVE, 'backup file')
    expect(text).not.toContain(encodeURIComponent(TITLE))
  })

  await test.step('addresses visited carried identifiers only', async () => {
    for (const url of visited) expectNoneOf(decodeURIComponent(url), SENSITIVE, `URL ${url}`)
  })

  await test.step('console output carried no content', async () => {
    expectNoneOf(consoleLines.join('\n'), SENSITIVE, 'console')
  })

  await test.step('every request is a same-origin static GET with no body and no content', async () => {
    const origin = new URL(page.url()).origin
    const http = requests.filter((request) => /^https?:/.test(request.url))
    expect(http.length).toBeGreaterThan(0)
    for (const request of http) {
      const url = new URL(request.url)
      expect(url.origin, `${request.url} is same-origin`).toBe(origin)
      expect(['GET', 'HEAD'], `${request.method} ${request.url}`).toContain(request.method)
      expect(request.postData, `body of ${request.url}`).toBeNull()
      expect(url.search, `query of ${request.url}`).toBe('')
      expect(url.pathname, `${request.url} is a static asset path`).toMatch(/(\/|\.html|\.js|\.css|\.woff2?|\.png|\.webmanifest|\.txt)$/)
      expectNoneOf(decodeURIComponent(request.url), SENSITIVE, 'request URL')
    }
    // Limitation: requests issued by the service worker itself are only reported by some
    // engines (request.serviceWorker() is Chromium-specific). The worker has no fetch
    // handler or runtime caching, so it makes none beyond precache installation, but
    // that is a property of the build, checked by the dist smoke check below, not by
    // this recorder on every engine.
    testInfo.annotations.push({ type: 'service worker requests', description: String(requests.filter((request) => request.fromServiceWorker).length) })
    // The worker script itself is fetched from the same origin like any other asset.
    expect(http.some((request) => new URL(request.url).pathname.endsWith('/sw.js'))).toBe(true)
    // Non-http schemes (data: or blob: resources) never leave the browser; list them for review.
    const local = requests.filter((request) => !/^https?:/.test(request.url)).map((request) => request.url.slice(0, 24))
    testInfo.annotations.push({ type: 'non-http requests', description: local.join(', ') || 'none' })
  })
})

test('the production bundle carries no test hook, mock, or weakened key derivation', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Reads build files only, so one project is enough.')
  const dist = resolve(process.cwd(), 'dist')
  const files: string[] = []
  async function collect(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await collect(path)
      else if (/\.(js|html|webmanifest)$/.test(entry.name)) files.push(path)
    }
  }
  await collect(dist)
  expect(files.length).toBeGreaterThan(2)
  const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n')
  // Smoke check only: a text grep over the minified build catches an accidentally shipped
  // hook or lowered constant by name, but it cannot prove the absence of obfuscated ones.
  // Page globals as hooks, other than the build tool's own manifest variable.
  const globals = [...source.matchAll(/\b(?:window|globalThis|self)\.__(\w+)/g)].map((match) => match[1]).filter((name) => !/^WB/.test(name))
  expect(globals, 'global hook names').toEqual([])
  for (const word of ['mockCrypto', 'fakeCrypto', 'skipKdf', 'skipKDF', 'testHook', 'debugUnlock', 'bypassLock', 'insecureMode', 'fake-indexeddb', '@testing-library']) {
    expect(source, `bundle must not contain ${word}`).not.toContain(word)
  }
  // The documented iteration count is the only one in the bundle.
  expect(source).toMatch(/=6e5\b/)
  expect(source).not.toMatch(/iterations\s*:\s*(?:[1-9]\d{0,4}|[1-5]\d{5})\b(?!\d)/)
})

test.describe('a revealed secret hides itself', () => {
  async function openSecret(page: Page) {
    await createLibrary(page)
    await addNote(page, { body: SYNTHETIC_TOKEN, title: TITLE, secret: true })
    await page.getByRole('link', { name: `${TITLE}, secret note` }).click()
    const reader = page.getByRole('dialog', { name: 'Note' })
    await reader.getByRole('button', { name: 'Reveal' }).click()
    await expect(reader.locator('pre')).toHaveText(SYNTHETIC_TOKEN)
    return reader
  }

  test('after 30 seconds, using a controlled clock', async ({ page }) => {
    await page.clock.install()
    const reader = await openSecret(page)
    await page.clock.fastForward(29_000)
    await expect(reader.locator('pre')).toHaveText(SYNTHETIC_TOKEN)
    await page.clock.fastForward(1_500)
    await expect(reader.locator('pre')).toHaveCount(0)
    await expect(reader.getByRole('status')).toHaveText('Secret hidden.')
    expectNoneOf(await exposed(page), [SYNTHETIC_TOKEN], 'page after auto-hide')
  })

  // A real hidden tab cannot be produced in a headless run, so the page is told what a
  // browser tells it: visibilityState becomes hidden and visibilitychange fires. Whether
  // a real phone or desktop browser fires it when switching apps is a manual check.
  test('when the document becomes hidden', async ({ page }) => {
    const reader = await openSecret(page)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(reader.locator('pre')).toHaveCount(0)
    expectNoneOf(await exposed(page), [SYNTHETIC_TOKEN], 'page after the tab was hidden')
  })
})
