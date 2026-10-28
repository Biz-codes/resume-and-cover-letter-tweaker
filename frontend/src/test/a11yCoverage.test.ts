// Accessibility checks that cover the whole front end rather than one component:
// - every .tsx file has a sibling .test.tsx that runs axe (expectNoA11yViolations);
// - the text colors in index.css meet WCAG AA contrast, which axe can't measure in jsdom.
import { describe, expect, inject, it } from 'vitest'
import css from '../index.css?raw'

declare module 'vitest' {
  export interface ProvidedContext {
    // Each .tsx file under src ("pages/SkillsPage.tsx") with its sibling test's text, or null.
    // Provided by vite.config.ts.
    componentTests: Record<string, string | null>
  }
}

// Files that render nothing of their own to test.
const NO_TEST_NEEDED = new Set(['main.tsx'])

describe('accessibility coverage', () => {
  it('has an axe check in a test beside every component and page', () => {
    const missing = Object.entries(inject('componentTests'))
      .filter(([file, test]) => !NO_TEST_NEEDED.has(file) && !test?.includes('expectNoA11yViolations('))
      .map(([file]) => file)
    expect(missing, 'Add a .test.tsx that calls expectNoA11yViolations() for each of these').toEqual([])
  })
})

// [foreground selector, background selector, what it is]. Selectors are written as they
// appear in index.css (comma lists joined with ", "). Add a pair for every new text color or
// background.
const CONTRAST_PAIRS: [string, string, string][] = [
  [':root', ':root', 'body text'],
  ['.nav-group, .muted', ':root', 'muted text'],
  ["[role='alert']", ':root', 'error text'],
  ["[role='alert']", '.note, .confirm', 'error text in a delete confirm'],
  [':root', '.note, .confirm', 'text in a note or delete confirm'],
  [':root', '.tag', 'tag text'],
]

function cssRules() {
  const rules = new Map<string, Record<string, string>>()
  for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const declarations = Object.fromEntries(
      body
        .split(';')
        .map((line) => line.split(':').map((part) => part.trim()))
        .filter((pair) => pair.length === 2 && pair[0]),
    )
    rules.set(selector.trim().replace(/\s*,\s*/g, ', '), declarations)
  }
  return rules
}

function luminance(hex: string) {
  const channels = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c) : hex.slice(1).match(/../g)!
  const [r, g, b] = channels.map((channel) => {
    const value = parseInt(channel, 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(first: string, second: string) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

describe('color contrast in index.css', () => {
  const rules = cssRules()
  const value = (selector: string, property: 'color' | 'background') => {
    const found = rules.get(selector)?.[property]
    if (!found?.match(/^#[0-9a-f]{3,6}$/i)) throw new Error(`index.css has no hex ${property} for "${selector}"`)
    return found
  }

  it.each(CONTRAST_PAIRS)('%s on %s (%s) is at least 4.5:1', (foreground, background) => {
    expect(contrast(value(foreground, 'color'), value(background, 'background'))).toBeGreaterThanOrEqual(4.5)
  })
})
