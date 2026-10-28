// Accessibility checks that cover the whole front end rather than one component. Vitest runs
// them as global setup (vite.config.ts) before every test run, including runs of a single
// file and reruns in watch mode, and stops the run if any fail:
// - every .tsx file under src has a sibling .test.tsx (src/test/setup.ts runs axe after each
//   test in it);
// - oxlint's jsx-a11y rules pass;
// - the text colors in index.css meet WCAG AA contrast, which axe can't measure in jsdom.
// axe itself runs inside the tests: see src/test/axe.ts.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { TestProject } from 'vitest/node'

const SRC = new URL('./src/', import.meta.url)

// Files that render nothing of their own to test.
const NO_TEST_NEEDED = new Set(['main.tsx'])

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

function contrastProblems() {
  const rules = cssRules()
  const problems: string[] = []
  for (const [foreground, background, what] of CONTRAST_PAIRS) {
    const fg = rules.get(foreground)?.color
    const bg = rules.get(background)?.background
    if (!fg?.match(/^#[0-9a-f]{3,6}$/i) || !bg?.match(/^#[0-9a-f]{3,6}$/i)) {
      problems.push(`index.css needs a hex color on "${foreground}" and a hex background on "${background}" (${what}).`)
      continue
    }
    const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
    const ratio = (light + 0.05) / (dark + 0.05)
    if (ratio < 4.5) problems.push(`${what}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1; WCAG AA needs 4.5:1.`)
  }
  return problems
}

export function a11yProblems() {
  return [...missingTests(), ...lintProblems(), ...contrastProblems()]
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
