// The end of a library page: its hidden items (docs/FRONTEND_CHECKS.md, "Hiding"), behind
// "Hidden (n)", closed to start. Each card there has Unhide beside View and Edit (`UnhideButton`).
// Nothing shows when the page has none.
import { useState, type ReactNode } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import Disclosure from '../shared/components/Disclosure/Disclosure'

export default function HiddenItems({ count, children }: { count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <div className="section-group">
      <Disclosure title={`Hidden (${count})`} heading={3}>
        {children}
      </Disclosure>
    </div>
  )
}

// Unhide on a hidden item's card. `onUnhide` saves, reads the page again, and moves focus to the
// item's card in the page's other groups; a failure shows here.
export function UnhideButton({ name, onUnhide }: { name: string; onUnhide: () => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  async function unhide() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onUnhide()
    } catch (caught) {
      setError(toApiError(caught))
      setSaving(false)
    }
  }

  return (
    <>
      {/* aria-disabled, not disabled, so the button keeps focus while it saves. */}
      <button type="button" aria-label={`Unhide "${name}"`} aria-disabled={saving} onClick={() => void unhide()}>
        {saving ? 'Unhiding…' : 'Unhide'}
      </button>
      {error && <p role="alert">{error.message}</p>}
    </>
  )
}
