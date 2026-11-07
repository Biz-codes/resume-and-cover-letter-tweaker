// What an item's edit form needs for asking which resumes and cover letters in progress get the
// change (docs/FRONTEND_CHECKS.md, "Changing an item"): the note above its fields, and the notice
// after saving.
import type { Use } from '../shared/api/usage'
import type { Placement } from './items/itemHost'

// The ones in progress that use the item. Opened from a resume's or cover letter's tree, that one
// (`here`) gets the change; the choice is for the others.
export function inProgressUses(usedBy: Use[], where: Placement['where'] | undefined) {
  const inProgress = usedBy.filter((use) => !use.locked)
  const here = inProgress.find((use) => use.kind === where?.kind && use.id === where?.id)
  return { here, others: inProgress.filter((use) => use !== here) }
}

// The apply_to list sent with the edit: the one it's opened from, then the ones checked.
export const pickedFor = (here: Use | undefined, checked: Use[]) => (here ? [here, ...checked] : checked)

// The note above the fields saying what Save will do, after the note for a sent version (`sent`)
// when there is one. Opened from a resume's or cover letter's tree (`doc`), that one gets the
// change; from the library, only the ones checked do.
export function changeNote(here: Use | undefined, others: Use[], doc: string | undefined, sent?: string) {
  let note: string | undefined
  if (doc) note = others.length > 0 ? `Saving changes it in this ${doc}, and in the others you check below.` : `Saving changes it in this ${doc} only.`
  else if (here || others.length > 0) note = 'Saving changes it only in the ones you check below; the rest keep it as it is.'
  return [sent, note].filter(Boolean).join(' ') || undefined
}

// The notice after saving. `before` and `after` name the original and the row saved, which is a
// new version when their ids differ.
export function savedMessage({
  newVersion,
  before,
  after,
  here,
  doc,
  checked,
}: {
  newVersion: boolean
  before: string
  after: string
  here: Use | undefined
  // "resume" or "cover letter", when opened from one's tree.
  doc: string | undefined
  checked: Use[]
}) {
  if (!newVersion) return 'Saved.'
  if (here) {
    const others = checked.length > 0 ? ', as do the others you checked' : ''
    return `Saved as a new version, "${after}", which this ${doc} uses now${others}. Everything else keeps "${before}".`
  }
  if (checked.length > 0) {
    return `Saved as a new version, "${after}". The ones in progress you checked use it now; everything else keeps "${before}".`
  }
  return `Saved as a new version, "${after}". Everything that used "${before}" still does; pick the new version where you want it.`
}
