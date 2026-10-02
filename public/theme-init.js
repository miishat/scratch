/* global document, localStorage, matchMedia */
// Runs before first paint so the page never flashes the wrong theme. It is a
// same-origin file, not an inline script, so the Content Security Policy needs no
// script hash or 'unsafe-inline'. Keep the logic identical to src/features/theme/theme.ts:
// an explicit light or dark choice wins, otherwise the page follows the system, and the
// saved palette for the resolved mode (or that mode's default) is applied.
(() => {
  const palettes = {
    light: ['parchment', 'classic', 'rosewater'],
    dark: ['espresso', 'slate', 'forest'],
  }
  const styles = {
    noteStyle: ['scratch-note-style', ['index', 'paper', 'sticky', 'quiet']],
    collectionStyle: ['scratch-collection-style', ['stacked', 'classic', 'tab', 'edge']],
  }
  for (const [name, [key, ids]] of Object.entries(styles)) {
    let value = null
    try { value = localStorage.getItem(key) } catch { /* Storage can be unavailable. */ }
    document.documentElement.dataset[name] = ids.includes(value) ? value : ids[0]
  }
  let preference = 'system'
  const saved = { light: null, dark: null }
  try {
    const stored = localStorage.getItem('scratch-theme')
    if (stored === 'light' || stored === 'dark') preference = stored
    saved.light = localStorage.getItem('scratch-light-palette')
    saved.dark = localStorage.getItem('scratch-dark-palette')
  } catch { /* Storage can be unavailable. */ }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = preference === 'system' ? (dark ? 'dark' : 'light') : preference
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.palette = palettes[resolved].includes(saved[resolved]) ? saved[resolved] : palettes[resolved][0]
  document.documentElement.style.colorScheme = resolved
})()
