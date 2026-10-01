export type CopyResult = 'copied' | 'denied' | 'unavailable'

// The single boundary for clipboard writes. Callers invoke it from an explicit
// user action. The text is written exactly as given, and 'copied' is returned
// only after the write promise resolves. Nothing here logs or retains the text,
// and the clipboard is never cleared on a timer.
export async function copyNote(body: string): Promise<CopyResult> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (typeof clipboard?.writeText !== 'function' || globalThis.isSecureContext === false) return 'unavailable'
  try {
    await clipboard.writeText(body)
    return 'copied'
  } catch {
    return 'denied'
  }
}
