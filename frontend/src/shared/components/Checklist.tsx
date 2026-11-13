// A named group of checkboxes for picking any number of items, such as the sections that list
// a narrative content excerpt. Lists the options A to Z; `selected` holds the checked ids. An
// option's `description` (such as the writing rules a text breaks) shows under it and is read
// with its checkbox.
import { useId, type ReactNode } from 'react'
import { sortByName } from '../sortByName'

export default function Checklist({
  legend,
  options,
  selected,
  onChange,
}: {
  legend: string
  options: { id: number; name: string; description?: ReactNode }[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  const idBase = useId()

  function toggle(id: number, checked: boolean) {
    onChange(options.map((option) => option.id).filter((optionId) => (optionId === id ? checked : selected.includes(optionId))))
  }

  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
      {options.length === 0 && <p className="muted">None yet.</p>}
      {sortByName(options, (option) => option.name).map((option) => {
        const descriptionId = `${idBase}-${option.id}`
        return (
          <div key={option.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                aria-describedby={option.description ? descriptionId : undefined}
                onChange={(event) => toggle(option.id, event.target.checked)}
              />
              {option.name}
            </label>
            {option.description && <div id={descriptionId}>{option.description}</div>}
          </div>
        )
      })}
    </fieldset>
  )
}
