import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// WCAG 2.x contrast computed from the real design tokens, so a palette edit that
// breaks a semantic pair fails here. Borders are decorative by design (design
// brief, section on color), so only text, controls, and focus rings are held to
// thresholds; a second check keeps controls from depending on the decorative border.

const tokensCss = readFileSync(resolve(process.cwd(), 'src/app/tokens.css'), 'utf8')
const globalCss = readFileSync(resolve(process.cwd(), 'src/app/global.css'), 'utf8')

type Theme = Record<string, string>

function readTheme(selector: string): Theme {
  const block = [...tokensCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((rule) => rule[1].trim() === selector)
  if (!block) throw new Error(`No token block for ${selector}`)
  const tokens: Theme = {}
  for (const match of block[2].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[match[1]] = match[2]
  return tokens
}

const themes: Record<string, Theme> = {
  light: readTheme(':root, :root[data-theme="light"]'),
  dark: readTheme(':root[data-theme="dark"]'),
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

const SURFACES = ['page-bg', 'surface', 'sage', 'clay', 'ochre', 'slate'] as const

describe.each(Object.entries(themes))('%s theme contrast', (_name, theme) => {
  it('defines every token the checks use', () => {
    for (const token of [...SURFACES, 'text', 'muted', 'action', 'action-text', 'focus', 'border']) expect(theme[token], token).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it.each(SURFACES)('primary text on %s meets 4.5:1', (surface) => {
    expect(ratio(theme.text, theme[surface])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(SURFACES)('muted text on %s meets 4.5:1', (surface) => {
    expect(ratio(theme.muted, theme[surface])).toBeGreaterThanOrEqual(4.5)
  })

  it('action text on the primary button meets 4.5:1', () => {
    expect(ratio(theme['action-text'], theme.action)).toBeGreaterThanOrEqual(4.5)
  })

  it('toast text (surface on text) meets 4.5:1', () => {
    expect(ratio(theme.surface, theme.text)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(SURFACES)('control borders and focus rings meet 3:1 against %s', (surface) => {
    expect(ratio(theme.focus, theme[surface])).toBeGreaterThanOrEqual(3)
  })

  it('the primary button boundary meets 3:1 against the page and the surface it sits on', () => {
    expect(ratio(theme.action, theme['page-bg'])).toBeGreaterThanOrEqual(3)
    expect(ratio(theme.action, theme.surface)).toBeGreaterThanOrEqual(3)
  })

  it('the selected-state border (text color) meets 3:1 against the surface', () => {
    expect(ratio(theme.text, theme.surface)).toBeGreaterThanOrEqual(3)
  })
})

describe('decorative borders', () => {
  it('no input, textarea, or button rule relies on the decorative border token for its boundary', () => {
    const offenders: string[] = []
    for (const rule of globalCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = rule[1].trim()
      if (selector.startsWith('@') || selector.includes('::placeholder')) continue
      const control = /(^|[\s,>.])(button|input|textarea)\b|-button\b|\.color-choice\b|\.editor-textarea\b/.test(selector)
      if (control && /border[^;]*var\(--border\)/.test(rule[2])) offenders.push(selector)
    }
    expect(offenders).toEqual([])
  })

  it('records the measured decorative ratio so a change is visible in review', () => {
    const light = ratio(themes.light.border, themes.light['page-bg'])
    // Documented thin spot: the neutral card border is about 1.3:1 on the page.
    // It is decorative; cards are identified by their text and links, not by this line.
    expect(light).toBeGreaterThan(1)
    expect(light).toBeLessThan(3)
  })
})
