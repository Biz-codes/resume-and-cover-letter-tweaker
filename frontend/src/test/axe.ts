// Accessibility checks with axe-core (WCAG 2.2 A and AA, plus axe's best practices).
// src/test/setup.ts runs this after every test; tests call it themselves for the states they
// pass through before the end. a11yChecks.ts holds the checks that cover the whole front end.
// See the /a11y skill for what axe can't check.
import axe from 'axe-core'
import { expect } from 'vitest'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice']

// jsdom has no layout, so axe can't measure contrast (a11yChecks.ts checks the CSS
// colors instead). The page-level rules only make sense for a whole page (page: true).
const JSDOM_RULES = { 'color-contrast': { enabled: false } }
const PAGE_RULES = ['region', 'landmark-one-main', 'page-has-heading-one']

function describe(results: axe.AxeResults) {
  return results.violations
    .map((violation) =>
      [
        `${violation.id} (${violation.impact}): ${violation.help}`,
        `  ${violation.helpUrl}`,
        ...violation.nodes.map((node) => `  - ${node.target.join(' ')}: ${node.failureSummary?.replace(/\n/g, ' ')}`),
      ].join('\n'),
    )
    .join('\n\n')
}

// Checks what's rendered right now. setup.ts runs it where each test ends; call it for each
// state a test passes through on the way (loading, form open, delete confirm open). page: true
// checks the whole document, including landmarks and the h1; use it for the app shell.
export async function expectNoA11yViolations({ page = false }: { page?: boolean } = {}) {
  const rules = page
    ? JSDOM_RULES
    : { ...JSDOM_RULES, ...Object.fromEntries(PAGE_RULES.map((id) => [id, { enabled: false }])) }
  const results = await axe.run(page ? document : document.body, { runOnly: { type: 'tag', values: TAGS }, rules })
  expect(results.violations.map((violation) => violation.id), describe(results)).toEqual([])
}
