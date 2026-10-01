import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyNote } from '../src/features/clipboard/copy'

function stubClipboard(writeText: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText === undefined ? undefined : { writeText } })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
})

describe('copyNote', () => {
  it('writes the exact multiline body including the trailing newline', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const body = '  line one\r\n\tline two\n\n'
    await expect(copyNote(body)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(body)
  })

  it('reports copied only after the write promise resolves', async () => {
    let finish!: () => void
    stubClipboard(vi.fn(() => new Promise<void>((resolve) => { finish = resolve })))
    let settled = false
    const pending = copyNote('x').then((result) => { settled = true; return result })
    await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    await expect(pending).resolves.toBe('copied')
  })

  it('reports denied when the clipboard rejects or throws', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')))
    await expect(copyNote('x')).resolves.toBe('denied')
    stubClipboard(vi.fn(() => { throw new Error('sync') }))
    await expect(copyNote('x')).resolves.toBe('denied')
  })

  it('reports unavailable without a clipboard API or outside a secure context', async () => {
    stubClipboard(undefined)
    await expect(copyNote('x')).resolves.toBe('unavailable')
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    vi.stubGlobal('isSecureContext', false)
    await expect(copyNote('x')).resolves.toBe('unavailable')
    expect(writeText).not.toHaveBeenCalled()
  })
})
