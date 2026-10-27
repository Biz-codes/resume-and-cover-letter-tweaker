// A parent's list of children (a section's categories, a category's skills): reorder,
// take out, and add from the items not listed yet. Each change is saved right away.
import { useState } from 'react'
import { toApiError, type ApiError } from '../api/client'

export interface ListItem {
  id: number
  name: string
}

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
  const listedIds = new Set(items.map((item) => item.id))
  const available = choices.filter((choice) => !listedIds.has(choice.id))

  async function save(ids: number[]) {
    setError(null)
    try {
      await onChange(ids)
    } catch (caught) {
      setError(toApiError(caught))
    }
  }

  function move(index: number, by: number) {
    const ids = items.map((item) => item.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + by, 0, moved)
    void save(ids)
  }

  return (
    <div className="ordered-list" aria-label={label} role="group">
      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ol>
          {items.map((item, index) => (
            <li key={item.id}>
              <span>{item.name}</span>
              <span className="row-actions">
                <button type="button" aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${item.name} down`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Take ${item.name} out`}
                  onClick={() => void save(items.filter((other) => other.id !== item.id).map((other) => other.id))}
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
          <select aria-label={`Add to ${label}`} value={adding} onChange={(event) => setAdding(event.target.value)}>
            <option value="">Choose one to add…</option>
            {available.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!adding}
            onClick={() => {
              void save([...items.map((item) => item.id), Number(adding)])
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
