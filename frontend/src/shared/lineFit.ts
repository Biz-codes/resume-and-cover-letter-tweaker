// How many printed lines a skill category's line or a bullet takes (docs/APP_FLOW.md, "Fitting on
// the page"), so a row that wraps says so where it's worked on. The same estimate as the page's:
// these numbers are backend/app/page_fit.py's CHARS_PER_LINE and BULLET_INDENT, which
// backend/tests/test_docs.py checks they match.
export const CHARS_PER_LINE = 110
export const BULLET_INDENT = 4

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth']

export function lineFit(text: string, bullet: boolean) {
  const width = bullet ? CHARS_PER_LINE - BULLET_INDENT : CHARS_PER_LINE
  const length = text.trim().length
  const lines = Math.max(1, Math.ceil(length / width))
  // What runs onto the last line: what to cut to save it.
  return { lines, onLast: length - (lines - 1) * width }
}

// "2 lines, 8 characters on the second", or null for one that fits on one line.
export function lineNote(text: string, bullet: boolean): string | null {
  const { lines, onLast } = lineFit(text, bullet)
  if (lines === 1) return null
  const which = ORDINALS[lines - 1] ?? 'last'
  return `${lines} lines, ${onLast} ${onLast === 1 ? 'character' : 'characters'} on the ${which}`
}

// A skill category's printed line: "Front End: React, TypeScript".
export const categoryLine = (name: string, skills: string[]) => `${name}: ${skills.join(', ')}`
