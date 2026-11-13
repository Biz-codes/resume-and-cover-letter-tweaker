// "It breaks a writing rule." for announcing a change, or nothing when it breaks none.
import type { WritingFlag } from '../../api/documents'

export const flagCount = (flags?: WritingFlag[]) =>
  flags?.length ? ` It breaks ${flags.length === 1 ? 'a writing rule' : `${flags.length} writing rules`}.` : ''
