// Accessibility checks that cover the whole front end rather than one component. Vitest runs
// them as global setup (vite.config.ts) before every test run, including runs of a single
// file and reruns in watch mode, and stops the run if any fail:
// - every .tsx file under src has a sibling .test.tsx (src/test/setup.ts runs axe after each
//   test in it);
// - oxlint's jsx-a11y rules pass;
// - the colors in index.css meet WCAG AA contrast, which axe can't measure in jsdom: 4.5:1 for
//   text, 3:1 for control edges, the focus ring, and icons; and components' CSS modules use only
//   the color and corner variables set there, so none goes unchecked.
// axe itself runs inside the tests: see src/test/axe.ts.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { TestProject } from 'vitest/node'

const SRC = new URL('./src/', import.meta.url)

// Files that render nothing of their own to test.
const NO_TEST_NEEDED = new Set(['main.tsx'])

// [foreground, background, what it is]. Each is a color variable set on :root in index.css
// ("--accent"), or a selector as it appears there (comma lists joined with ", "). Text needs
// 4.5:1. Add a pair for every new text color or background.
const CONTRAST_PAIRS: [string, string, string][] = [
  [':root', ':root', 'body text on the page'],
  ['--text', '--surface', 'text on a card, field, dialog, or panel'],
  ['--muted', '--page', 'muted text on the page'],
  ['--muted', '--surface', 'muted text on a card'],
  ['--muted', '--accent-tint', 'muted text in your own chat message'],
  ['--text', '--accent-tint', 'text on the accent tint: your chat messages, a row being moved, a hovered title'],
  ['--accent', '--surface', 'links and the accent on a card'],
  ['--accent', '--page', 'links on the page'],
  ['--accent', '--accent-tint', 'the current page in the nav, and tags'],
  ['--surface', '--accent', 'white text on a main button'],
  ['--error', '--surface', 'error text and Delete on a card'],
  ['--error', '--page', 'error text on the page'],
  ['--error', '--error-tint', 'a Flagged badge and an error box'],
  ['--warning', '--warning-tint', 'a warning, such as what would not fit'],
  ['--text', '--warning-tint', 'text on a warning row'],
  ['--text', '--badge-original', "an Original badge in Claude's draft"],
  ['--text', '--badge-claude', "a Claude badge in Claude's draft"],
  ['.tag', '.tag', 'tag text'],
]

// Parts of controls and graphics that people need to see (WCAG 1.4.11) need 3:1: field and
// button edges, the focus ring, and icons.
const NON_TEXT_PAIRS: [string, string, string][] = [
  ['--control-edge', '--surface', 'a field or button edge on a card'],
  ['--control-edge', '--page', 'a field or button edge on the page'],
  ['--outline', '--surface', 'the focus ring on a card'],
  ['--outline', '--page', 'the focus ring on the page'],
  ['--outline', '--accent-tint', 'the focus ring on a tinted row'],
  ['--warning-edge', '--surface', "a warning's edge"],
  ['--error', '--surface', 'an invalid field or Delete button edge'],
]

function missingTests() {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx') && !NO_TEST_NEEDED.has(file))
    .filter((file) => !existsSync(new URL(file.replace(/\.tsx$/, '.test.tsx'), SRC)))
    .map((file) => `src/${file} has no .test.tsx beside it.`)
}

type Diagnostic = { code: string; message: string; filename: string; labels: { span: { line: number } }[] }

function lintProblems() {
  let output: string
  try {
    output = execFileSync('node_modules/.bin/oxlint', ['--format', 'json', 'src'], {
      cwd: new URL('.', import.meta.url),
      encoding: 'utf8',
    })
  } catch (error) {
    // oxlint exits 1 when it finds errors; its report is still on stdout.
    output = (error as { stdout: string }).stdout
  }
  return (JSON.parse(output).diagnostics as Diagnostic[])
    .filter((diagnostic) => diagnostic.code.startsWith('jsx-a11y'))
    .map((d) => `${d.filename}:${d.labels[0]?.span.line ?? '?'} ${d.code}: ${d.message}`)
}

function cssRules() {
  const css = readFileSync(new URL('index.css', SRC), 'utf8')
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

// A selector's color or background, or a variable on :root, with var(--name) looked up there
// (and again, for a variable set to another one).
function colorOf(rules: Map<string, Record<string, string>>, selector: string, property: string) {
  const root = rules.get(':root') ?? {}
  let value = selector.startsWith('--') ? root[selector] : rules.get(selector)?.[property]
  for (let depth = 0; depth < 5; depth++) {
    const variable = value?.match(/^var\((--[\w-]+)\)$/)
    if (!variable) break
    value = root[variable[1]]
  }
  return value
}

function contrastProblems() {
  const rules = cssRules()
  const problems: string[] = []
  const pairs = [
    ...CONTRAST_PAIRS.map((pair) => [...pair, 4.5] as const),
    ...NON_TEXT_PAIRS.map((pair) => [...pair, 3] as const),
  ]
  for (const [foreground, background, what, needed] of pairs) {
    // An 8-digit hex has an alpha; none of these pairs uses one.
    const fg = colorOf(rules, foreground, 'color')
    const bg = colorOf(rules, background, 'background')
    if (!fg?.match(/^#[0-9a-f]{3,6}$/i) || !bg?.match(/^#[0-9a-f]{3,6}$/i)) {
      problems.push(`index.css needs a hex color on "${foreground}" and a hex background on "${background}" (${what}).`)
      continue
    }
    const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
    const ratio = (light + 0.05) / (dark + 0.05)
    if (ratio < needed) problems.push(`${what}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1; WCAG AA needs ${needed}:1.`)
  }
  return problems
}

// A color written in a CSS module, rather than a variable from index.css, which the contrast
// check can't see; and a corner size of its own, rather than the design's (--radius).
function moduleColors() {
  const modules = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.module.css'))
  const read = (file: string) => readFileSync(new URL(file, SRC), 'utf8')
  return [
    ...modules
      .filter((file) => /#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(/i.test(read(file)))
      .map((file) => `src/${file} sets its own color; use a color variable from index.css instead.`),
    ...modules
      .filter((file) => /border-radius:[ \t]*(?![ \t]|0\b|var\()/.test(read(file)))
      .map((file) => `src/${file} sets its own corner size; use --radius, --radius-lg, or --radius-pill.`),
  ]
}

export function a11yProblems() {
  return [...missingTests(), ...lintProblems(), ...contrastProblems(), ...moduleColors()]
}

function check() {
  const problems = a11yProblems()
  if (problems.length) {
    const error = new Error(`Accessibility checks failed (a11yChecks.ts):\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    // No stack frames: Vite's source maps can't map this file's, and the list is what matters.
    error.stack = error.message
    throw error
  }
}

export default function setup(project: TestProject) {
  check()
  project.onTestsRerun(check)
}
