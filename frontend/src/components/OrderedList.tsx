// A parent's list of children (a section's categories, a category's skills): reorder,
// take out, and add from the items not listed yet. Each change is saved right away.
// Focus never drops to the top of the page: the move buttons at either end use aria-disabled
// (a disabled button loses focus), removing an item moves focus to the list, and adding one
// moves it back to the picker.
import { useRef, useState } from 'react'
import { toApiError, type ApiError } from '../api/client'

export interface ListItem {
  id: number
  name: string
  // A shorter name for the buttons' labels, when the name is long (a bullet point).
  label?: string
}

const labelOf = (item: ListItem) => item.label ?? item.name

export default function OrderedList({
  label,
  items,
  choices,
  emptyText,
  onChange,
}: {
  label: string
  items: ListItem[]
  // Items that can be added (the ones already listed are left out here).
  choices: ListItem[]
  emptyText: string
  onChange: (ids: number[]) => Promise<void>
}) {
  const [error, setError] = useState<ApiError | null>(null)
  const [adding, setAdding] = useState('')
  const groupRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLSelectElement>(null)
  const listedIds = new Set(items.map((item) => item.id))
  const available = choices.filter((choice) => !listedIds.has(choice.id))

  async function save(ids: number[], focusAfter?: HTMLElement | null) {
    setError(null)
    try {
      await onChange(ids)
      focusAfter?.focus()
    } catch (caught) {
      setError(toApiError(caught))
    }
  }

  function move(index: number, by: number) {
    if (index + by < 0 || index + by >= items.length) return
    const ids = items.map((item) => item.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + by, 0, moved)
    void save(ids)
  }

  return (
    <div className="ordered-list" aria-label={label} role="group" tabIndex={-1} ref={groupRef}>
      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ol>
          {items.map((item, index) => (
            <li key={item.id}>
              <span>{item.name}</span>
              <span className="row-actions">
                <button
                  type="button"
                  aria-label={`Move ${labelOf(item)} up`}
                  aria-disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${labelOf(item)} down`}
                  aria-disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${labelOf(item)}`}
                  onClick={() =>
                    void save(
                      items.filter((other) => other.id !== item.id).map((other) => other.id),
                      groupRef.current,
                    )
                  }
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {available.length > 0 && (
        <div className="actions">
          <select
            ref={pickerRef}
            aria-label={`Add to ${label}`}
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
          >
            <option value="">Choose one to add…</option>
            {available.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-disabled={!adding}
            onClick={() => {
              if (!adding) return
              void save([...items.map((item) => item.id), Number(adding)], pickerRef.current)
              setAdding('')
            }}
          >
            Add
          </button>
        </div>
      )}
      {error && <p role="alert">{error.message}</p>}
    </div>
  )
}
