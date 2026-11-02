// A named group of checkboxes for picking any number of items, such as the sections that list
// a narrative content excerpt. Keeps the options' order; `selected` holds the checked ids.
export default function Checklist({
  legend,
  options,
  selected,
  onChange,
}: {
  legend: string
  options: { id: number; name: string }[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  function toggle(id: number, checked: boolean) {
    onChange(options.map((option) => option.id).filter((optionId) => (optionId === id ? checked : selected.includes(optionId))))
  }

  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
      {options.length === 0 && <p className="muted">None yet.</p>}
      {options.map((option) => (
        <label key={option.id}>
          <input
            type="checkbox"
            checked={selected.includes(option.id)}
            onChange={(event) => toggle(option.id, event.target.checked)}
          />
          {option.name}
        </label>
      ))}
    </fieldset>
  )
}
