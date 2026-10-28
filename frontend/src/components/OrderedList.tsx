// A parent's list of children (a section's categories, a category's skills, a role's bullets):
// reorder, take out, and add from the items not listed yet. Each change is saved right away.
//
// Reordering works three ways, all through each row's grip handle (a toggle button):
// - drag it with a mouse, pen, or finger;
// - keyboard: Space or Enter picks the item up, the up and down arrows move it, Space or Enter
//   drops it, and Escape puts it back;
// - without dragging (WCAG 2.5.7): click the handle to pick the item up, then "Move here" on
//   another row.
// Each step is announced in the list's live region. Focus never drops to the top of the
// page: it stays on the moving item's handle, removing an item moves focus to the list, and
// adding one moves it back to the picker.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { toApiError, type ApiError } from '../api/client'

export interface ListItem {
  id: number
  name: string
  // A shorter name for the buttons' labels, when the name is long (a bullet point).
  label?: string
}

const labelOf = (item: ListItem) => item.label ?? item.name

// How far a pointer moves before a press on the handle becomes a drag, in pixels.
const DRAG_THRESHOLD = 4

type Moving = { id: number; order: number[]; dragging: boolean }

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
  const [moving, setMoving] = useState<Moving | null>(null)
  // The order just dropped, shown until the saved list comes back, so rows don't jump back.
  const [saving, setSaving] = useState<number[] | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [focusId, setFocusId] = useState<{ id: number } | null>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLSelectElement>(null)
  const handles = useRef(new Map<number, HTMLButtonElement>())
  const rows = useRef(new Map<number, HTMLLIElement>())
  // A press on a handle that may become a drag (order is set once it does). Its pointer moves
  // are followed on the window: the dragged row moves in the page as the list rearranges, and
  // an element that moves loses the pointer it was tracking.
  const drag = useRef<{ item: ListItem; y: number; order: number[] | null } | null>(null)
  // The click that follows the end of a drag isn't a click on the handle.
  const suppressClick = useRef(false)
  const pointer = useRef({
    move: (_event: globalThis.PointerEvent) => {},
    end: (_event: globalThis.PointerEvent) => {},
  })
  const follow = useRef({
    move: (event: globalThis.PointerEvent) => pointer.current.move(event),
    end: (event: globalThis.PointerEvent) => pointer.current.end(event),
  })
  const instructionsId = useId()

  const byId = new Map(items.map((item) => [item.id, item]))
  const order = moving?.order ?? saving ?? items.map((item) => item.id)
  const shown = order.map((id) => byId.get(id)).filter((item): item is ListItem => Boolean(item))
  const available = choices.filter((choice) => !byId.has(choice.id))
  const movingItem = moving ? byId.get(moving.id) : undefined

  // Keep focus on the handle that's moving (or just dropped) as its row changes place.
  useEffect(() => {
    if (focusId) handles.current.get(focusId.id)?.focus()
  }, [focusId, order])

  const position = (ids: number[], id: number) => `position ${ids.indexOf(id) + 1} of ${ids.length}`

  async function save(ids: number[], focusAfter?: HTMLElement | null) {
    setError(null)
    try {
      await onChange(ids)
      focusAfter?.focus()
    } catch (caught) {
      setError(toApiError(caught))
    }
  }

  function pickUp(item: ListItem, dragging = false) {
    const ids = items.map((other) => other.id)
    setMoving({ id: item.id, order: ids, dragging })
    setAnnouncement(`Picked up ${labelOf(item)}, ${position(ids, item.id)}.`)
  }

  function moveTo(ids: number[]) {
    if (!moving || !movingItem) return
    setMoving({ ...moving, order: ids })
    setAnnouncement(`${labelOf(movingItem)}, ${position(ids, moving.id)}.`)
  }

  function step(by: number) {
    if (!moving) return
    const from = moving.order.indexOf(moving.id)
    const to = from + by
    if (to < 0 || to >= moving.order.length) return
    const ids = [...moving.order]
    ids.splice(from, 1)
    ids.splice(to, 0, moving.id)
    moveTo(ids)
  }

  function drop() {
    if (moving && movingItem) void dropAt(movingItem, moving.order)
  }

  async function dropAt(item: ListItem, ids: number[]) {
    const unchanged = ids.every((id, index) => id === items[index]?.id)
    setMoving(null)
    setFocusId({ id: item.id })
    setAnnouncement(`Dropped ${labelOf(item)}, ${position(ids, item.id)}.`)
    if (unchanged) return
    setSaving(ids)
    await save(ids)
    setSaving(null)
  }

  function cancel() {
    if (!moving || !movingItem) return
    setMoving(null)
    setFocusId({ id: moving.id })
    setAnnouncement(
      `Cancelled. ${labelOf(movingItem)} is back at ${position(
        items.map((item) => item.id),
        moving.id,
      )}.`,
    )
  }

  // "Move here" on a row: the moving item takes that row's place.
  function placeAt(target: number) {
    if (!moving) return
    const ids = moving.order.filter((id) => id !== moving.id)
    ids.splice(moving.order.indexOf(target), 0, moving.id)
    if (movingItem) void dropAt(movingItem, ids)
  }

  // Escape puts the item back from any button shown while it's moving.
  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  function onHandleKeyDown(event: KeyboardEvent, item: ListItem) {
    if (moving?.id !== item.id) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      setFocusId({ id: item.id })
      step(event.key === 'ArrowUp' ? -1 : 1)
    } else {
      cancelOnEscape(event)
    }
  }

  // Space and Enter click a button, so the keyboard and a plain click share this.
  function onHandleClick(item: ListItem) {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (moving?.id === item.id) drop()
    else pickUp(item)
  }

  function stopFollowing() {
    window.removeEventListener('pointermove', follow.current.move)
    window.removeEventListener('pointerup', follow.current.end)
    window.removeEventListener('pointercancel', follow.current.end)
  }

  useEffect(() => stopFollowing, [])

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, item: ListItem) {
    if (event.button !== 0) return
    drag.current = { item, y: event.clientY, order: null }
    window.addEventListener('pointermove', follow.current.move)
    window.addEventListener('pointerup', follow.current.end)
    window.addEventListener('pointercancel', follow.current.end)
  }

  pointer.current.move = (event) => {
    const current = drag.current
    if (!current) return
    if (!current.order) {
      if (Math.abs(event.clientY - current.y) < DRAG_THRESHOLD) return
      current.order = items.map((other) => other.id)
      pickUp(current.item, true)
      return
    }
    // The item goes before the first other row whose middle is below the pointer.
    const others = current.order.filter((id) => id !== current.item.id)
    let index = others.findIndex((id) => {
      const box = rows.current.get(id)?.getBoundingClientRect()
      return box ? event.clientY < box.top + box.height / 2 : false
    })
    if (index === -1) index = others.length
    const ids = [...others]
    ids.splice(index, 0, current.item.id)
    if (ids.every((id, i) => id === current.order?.[i])) return
    current.order = ids
    setMoving({ id: current.item.id, order: ids, dragging: true })
    setAnnouncement(`${labelOf(current.item)}, ${position(ids, current.item.id)}.`)
  }

  pointer.current.end = (event) => {
    stopFollowing()
    const current = drag.current
    drag.current = null
    if (!current?.order) return
    suppressClick.current = true
    setTimeout(() => (suppressClick.current = false))
    if (event.type === 'pointercancel') {
      setMoving(null)
      setFocusId({ id: current.item.id })
      setAnnouncement(
        `Cancelled. ${labelOf(current.item)} is back at ${position(
          items.map((item) => item.id),
          current.item.id,
        )}.`,
      )
    } else {
      void dropAt(current.item, current.order)
    }
  }

  return (
    <div className="ordered-list" aria-label={label} role="group" tabIndex={-1} ref={groupRef}>
      <p id={instructionsId} hidden>
        Drag to reorder, or press Space to pick up, the up and down arrow keys to move, and Space to drop. Escape
        cancels.
      </p>
      {shown.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ol>
          {shown.map((item, index) => (
            <li
              key={item.id}
              className={moving?.id === item.id ? 'moving' : undefined}
              ref={(row) => {
                if (row) rows.current.set(item.id, row)
                else rows.current.delete(item.id)
              }}
            >
              <button
                type="button"
                className="handle"
                ref={(handle) => {
                  if (handle) handles.current.set(item.id, handle)
                  else handles.current.delete(item.id)
                }}
                aria-label={`Move ${labelOf(item)}`}
                aria-pressed={moving?.id === item.id}
                aria-describedby={instructionsId}
                onClick={() => onHandleClick(item)}
                onKeyDown={(event) => onHandleKeyDown(event, item)}
                onPointerDown={(event) => onPointerDown(event, item)}
              >
                <span aria-hidden="true">⠿</span>
              </button>
              <span className="item-name">{item.name}</span>
              <span className="row-actions">
                {!moving && (
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
                )}
                {moving && !moving.dragging && movingItem && moving.id !== item.id && (
                  <button
                    type="button"
                    aria-label={`Move ${labelOf(movingItem)} here, to position ${index + 1}`}
                    onClick={() => placeAt(item.id)}
                    onKeyDown={cancelOnEscape}
                  >
                    Move here
                  </button>
                )}
                {moving && !moving.dragging && moving.id === item.id && (
                  <button type="button" onClick={cancel} onKeyDown={cancelOnEscape}>
                    Cancel move
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {available.length > 0 && !moving && (
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
      {/* A plain live region rather than role="status", so the page's notice stays its only status. */}
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
      {error && <p role="alert">{error.message}</p>}
    </div>
  )
}
