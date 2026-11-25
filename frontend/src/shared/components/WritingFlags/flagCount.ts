// "It breaks a writing rule." for announcing a change, or nothing when it breaks none. Flags the
// user dismissed don't count.
import { counted, type WritingFlag } from '../../api/documents'

export function flagCount(flags?: WritingFlag[]) {
  const shown = counted(flags)
  return shown.length ? ` It breaks ${shown.length === 1 ? 'a writing rule' : `${shown.length} writing rules`}.` : ''
}
