// What a notice says about the writing check on the user's own text after it's saved
// (backend/app/own_text.py): how many writing rules it breaks, or that it couldn't be checked.
// Nothing when it breaks none.
import type { WritingFlag } from './api/documents'

export function flagsNote(flags: WritingFlag[] | null | undefined) {
  if (flags === null) return " Its wording couldn't be checked against your writing rules."
  if (!flags?.length) return ''
  return ` It breaks ${flags.length === 1 ? '1 writing rule' : `${flags.length} writing rules`}, marked Flagged.`
}
