import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readHeaderBlock } from '../config/headers'

// The Content Security Policy in public/_headers is preparation for static hosting
// (nothing is deployed). These checks fail if the policy is weakened, or if the page
// grows an inline script or style that the policy would then have to allow.

const root = (file: string) => resolve(process.cwd(), file)
const headers = readHeaderBlock(root('public/_headers'), '/*')
const policy = headers['Content-Security-Policy'] ?? ''

function directive(name: string): string[] | undefined {
  const found = policy.split(';').map((part) => part.trim().split(/\s+/)).find((parts) => parts[0] === name)
  return found?.slice(1)
}

describe('Content Security Policy in public/_headers', () => {
  it('exists and is read from the /* block', () => {
    expect(policy.length).toBeGreaterThan(50)
  })

  it('denies by default and allows only same-origin scripts, styles, fonts, images, manifest, workers, and connections', () => {
    expect(directive('default-src')).toEqual(["'none'"])
    for (const name of ['script-src', 'style-src', 'font-src', 'img-src', 'manifest-src', 'worker-src', 'connect-src']) expect(directive(name), name).toEqual(["'self'"])
  })

  it('forbids objects, framing, base changes, and form posts', () => {
    expect(directive('object-src')).toEqual(["'none'"])
    expect(directive('frame-ancestors')).toEqual(["'none'"])
    expect(directive('base-uri')).toEqual(["'none'"])
    expect(directive('form-action')).toEqual(["'none'"])
  })

  it('never allows unsafe-inline, unsafe-eval, wildcards, other origins, data:, blob:, or http:', () => {
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval|strict-dynamic/)
    expect(policy).not.toMatch(/\*|https?:|data:|blob:|filesystem:|ws:|wss:/)
    // Every source other than the keywords 'self' and 'none' would be a named host.
    const sources = policy.split(';').flatMap((part) => part.trim().split(/\s+/).slice(1))
    expect(sources.filter((source) => source !== "'self'" && source !== "'none'")).toEqual([])
  })

  it('sets the companion headers and keeps the shell and worker revalidated', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('no-referrer')
    const file = readFileSync(root('public/_headers'), 'utf8')
    for (const path of ['/index.html', '/sw.js', '/theme-init.js']) expect(readHeaderBlock(root('public/_headers'), path)['Cache-Control'], path).toBe('no-cache')
    expect(file).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/)
  })

  it('is what the preview server applies', () => {
    expect(readFileSync(root('vite.config.ts'), 'utf8')).toMatch(/preview:\s*\{\s*headers:\s*readHeaderBlock\('public\/_headers', '\/\*'\)/)
  })
})

describe('what the policy relies on', () => {
  const html = readFileSync(root('index.html'), 'utf8')

  it('index.html has no inline script, handler, style element, or style attribute', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i)
    expect(html).not.toMatch(/\son[a-z]+=/i)
    expect(html).not.toMatch(/<style[\s>]/i)
    expect(html).not.toMatch(/\sstyle=/i)
  })

  it('the pre-paint theme script is a same-origin file with a relative path (sub-path safe) and matches theme.ts', () => {
    expect(html).toMatch(/<script src="theme-init\.js"><\/script>/)
    const init = readFileSync(root('public/theme-init.js'), 'utf8')
    const theme = readFileSync(root('src/features/theme/theme.ts'), 'utf8')
    const key = /themeStorageKey = '([^']+)'/.exec(theme)![1]
    expect(init).toContain(`localStorage.getItem('${key}')`)
    expect(init).toContain("stored === 'light' || stored === 'dark'")
    expect(init).toContain('prefers-color-scheme: dark')
  })

  it('no source file writes a style attribute as markup, which the policy would block', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = `${dir}/${entry}`
        if (/\.(tsx?|css)$/.test(entry)) {
          const text = readFileSync(path, 'utf8')
          if (/setAttribute\(\s*['"]style['"]|insertAdjacentHTML|innerHTML\s*=|outerHTML\s*=|dangerouslySetInnerHTML|document\.write/.test(text)) offenders.push(path)
        } else if (!entry.includes('.')) walk(path)
      }
    }
    walk(root('src'))
    expect(offenders).toEqual([])
  })
})

