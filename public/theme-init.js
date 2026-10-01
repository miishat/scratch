/* global document, localStorage, matchMedia */
// Runs before first paint so the page never flashes the wrong theme. It is a
// same-origin file, not an inline script, so the Content Security Policy needs no
// script hash or 'unsafe-inline'. Keep the logic identical to src/features/theme/theme.ts:
// an explicit light or dark choice wins, otherwise the page follows the system.
(() => {
  let preference = 'system'
  try {
    const stored = localStorage.getItem('scratch-theme')
    if (stored === 'light' || stored === 'dark') preference = stored
  } catch { /* Storage can be unavailable. */ }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = preference === 'system' ? (dark ? 'dark' : 'light') : preference
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
})()
