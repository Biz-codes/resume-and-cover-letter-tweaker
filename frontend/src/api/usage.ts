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

export const anyLocked = (uses: Use[]) => uses.some((use) => use.locked)
