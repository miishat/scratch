import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

// Moves a library between two independent browser contexts (separate storage)
// through a real download and a real file upload.

const PASSPHRASE = 'correct horse battery staple'
const NOTE_TITLE = 'Transfer check note'
const NOTE_BODY = 'Body that must survive the transfer exactly.'

async function createLibrary(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await page.getByLabel('Confirm passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Create vault' }).click()
  await page.locator('.empty-actions').getByRole('button', { name: 'Add note' }).click()
  await page.getByRole('textbox', { name: 'Note body' }).fill(NOTE_BODY)
  await page.getByRole('button', { name: 'Add title' }).click()
  await page.getByLabel('Title').fill(NOTE_TITLE)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(NOTE_TITLE)).toBeVisible()
}

test('a library moves between two browser contexts through a downloaded backup', async ({ browser }, testInfo) => {
  const sender = await browser.newContext({ acceptDownloads: true })
  const receiver = await browser.newContext()
  try {
    const a = await sender.newPage()
    await createLibrary(a)
    await a.getByRole('button', { name: 'Settings' }).click()
    const downloading = a.waitForEvent('download')
    await a.getByRole('button', { name: 'Export backup' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/^scratch-backup-\d{4}-\d{2}-\d{2}-\d{4}\.scratch$/)
    const path = testInfo.outputPath('transfer.scratch')
    await download.saveAs(path)
    const text = await readFile(path, 'utf8')
    expect(text).not.toContain(NOTE_TITLE)
    expect(text).not.toContain(NOTE_BODY)
    expect(text).not.toContain(PASSPHRASE)

    const b = await receiver.newPage()
    await b.goto('/')
    await expect(b.getByRole('heading', { name: 'Set up Scratch' })).toBeVisible()
    await b.getByRole('button', { name: 'Import backup' }).click()
    await b.getByLabel('Backup file').setInputFiles(path)
    await b.getByLabel('Backup passphrase').fill(PASSPHRASE)
    await b.getByRole('button', { name: 'Review backup' }).click()
    await expect(b.getByText('This backup contains 1 item.')).toBeVisible({ timeout: 30000 })
    await b.getByRole('button', { name: 'Import library' }).click()
    await expect(b.getByText(NOTE_TITLE)).toBeVisible({ timeout: 30000 })
    await b.getByText(NOTE_TITLE).click()
    await expect(b.getByText(NOTE_BODY)).toBeVisible()
  } finally {
    await sender.close()
    await receiver.close()
  }
})
