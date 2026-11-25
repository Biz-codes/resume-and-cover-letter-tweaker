// What a notice says about the writing check on the user's own text after it's saved
// (backend/app/own_text.py): how many writing rules it breaks, or that it couldn't be checked.
// Nothing when it breaks none.
import { counted, type WritingFlag } from './api/documents'

export function flagsNote(flags: WritingFlag[] | null | undefined) {
  if (flags === null) return " Its wording couldn't be checked against your writing rules."
  const shown = counted(flags)
  if (!shown.length) return ''
  return ` It breaks ${shown.length === 1 ? '1 writing rule' : `${shown.length} writing rules`}, marked Flagged.`
}
