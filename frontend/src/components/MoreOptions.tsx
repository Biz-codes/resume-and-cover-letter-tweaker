// "More options" under a list in a resume's or cover letter's tree: the items that could go in
// it besides the ones it shows (its defaults), behind a level that opens and closes. The user
// checks any number and adds them together; they go last, in the order offered. Choices with a
// `group` are shown under that heading, in the order each group first appears. With nothing more
// to offer, it says so.
import { Fragment, useState } from 'react'
import Disclosure from './Disclosure'
import type { ListItem, ListKey } from './OrderedList'

export default function MoreOptions<K extends ListKey>({
  label,
  choices,
  onAdd,
}: {
  // The list's name, so each level and button says which list it adds to.
  label: string
  choices: ListItem<K>[]
  // Resolves true once added, false when it was refused (the list shows why).
  onAdd: (ids: K[]) => Promise<boolean>
}) {
  const [checked, setChecked] = useState<K[]>([])
  const [saving, setSaving] = useState(false)
  // Kept in its place, so the user knows there's nothing else rather than wondering where it went.
  if (choices.length === 0) {
    return (
      <p className="muted">
        No more options<span className="visually-hidden"> for {label}</span>: everything listed here is already shown.
      </p>
    )
  }

  const groups = new Map<string, ListItem<K>[]>()
  for (const choice of choices) groups.set(choice.group ?? '', [...(groups.get(choice.group ?? '') ?? []), choice])
  // Checked ones that are still offered, in the order offered.
  const chosen = choices.map((choice) => choice.id).filter((id) => checked.includes(id))

  function toggle(id: K, on: boolean) {
    setChecked(on ? [...checked, id] : checked.filter((other) => other !== id))
  }

  async function add() {
    if (saving || chosen.length === 0) return
    setSaving(true)
    if (await onAdd(chosen)) setChecked([])
    setSaving(false)
  }

  const boxes = (options: ListItem<K>[]) =>
    options.map((option) => (
      <label key={option.id}>
        <input type="checkbox" checked={checked.includes(option.id)} onChange={(event) => toggle(option.id, event.target.checked)} />
        {option.name}
      </label>
    ))

  return (
    <Disclosure
      title={
        <>
          More options <span className="visually-hidden">for {label}</span> ({choices.length})
        </>
      }
    >
      <fieldset className="choice more-options">
        <legend>Choose any to add to {label}</legend>
        {[...groups].map(([group, options]) =>
          group ? (
            <fieldset key={group} className="choice">
              <legend>{group}</legend>
              {boxes(options)}
            </fieldset>
          ) : (
            <Fragment key="">{boxes(options)}</Fragment>
          ),
        )}
      </fieldset>
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="button" aria-label={saving ? `Adding checked to ${label}` : `Add checked to ${label}`} aria-disabled={saving || chosen.length === 0} onClick={() => void add()}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </div>
    </Disclosure>
  )
}
