export function missingRequiredApis(): string[] {
  const missing: string[] = []
  if (!('indexedDB' in globalThis) || !globalThis.indexedDB) missing.push('IndexedDB')
  if (!globalThis.crypto?.subtle) missing.push('crypto.subtle')
  if (typeof Intl.Segmenter !== 'function') missing.push('Intl.Segmenter')
  return missing
}
