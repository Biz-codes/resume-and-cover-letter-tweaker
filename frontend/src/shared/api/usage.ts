// Where a library item is used. A locked use is a sent version (or a posting already
// applied to): it keeps the item as it is, so editing the item saves a new version.
export interface Use {
  kind: 'job_posting' | 'resume' | 'cover_letter'
  id: number
  name: string
  locked: boolean
}

export const KIND_LABELS: Record<Use['kind'], string> = {
  job_posting: 'Job posting',
  resume: 'Resume',
  cover_letter: 'Cover letter',
}

// Each use's own page, where its name links to.
export const pathOf = (use: Use) =>
  ({ job_posting: '/postings', resume: '/resumes', cover_letter: '/cover-letters' })[use.kind] + `/${use.id}`

// The ones checked for a change (apply_to), as the API takes them.
export const refs = (uses: Use[]) => uses.map(({ kind, id }) => ({ kind, id }))

export const anyLocked = (uses: Use[]) => uses.some((use) => use.locked)

// Used, and only by sent versions: its text went out as it is, so it isn't held to the writing
// rules (no flags, no "Not checked" note). Once it's in a version still being worked on, it is.
export const onlySent = (uses: Use[]) => uses.length > 0 && uses.every((use) => use.locked)

// Not checked against the writing rules yet, and not only in sent versions (so worth checking).
export const isUnchecked = (item: { flags: unknown[] | null; used_by: Use[] }) => item.flags === null && !onlySent(item.used_by)
