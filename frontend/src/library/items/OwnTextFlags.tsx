// What the writing check found in a bullet's or narrative content's saved text (backend/app/
// own_text.py), in its dialog: "Flagged" with each rule it breaks and why, or, when it hasn't been
// checked (saved before the check, read from the user's own file, or the check failed), a note
// saying so. Either way, "Check writing rules" runs the check alone on the saved text, and the
// dialog's notice says what it found. Nothing shows when it breaks none. The text is never changed.
import { useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import type { WritingFlag } from '../../shared/api/documents'
import WritingFlags from '../../shared/components/WritingFlags/WritingFlags'
import { useItemHost } from './itemHost'

export default function OwnTextFlags({
  name,
  flags,
  onCheck,
}: {
  // The item, for the list's and the button's names.
  name: string
  // Null when it hasn't been checked.
  flags: WritingFlag[] | null | undefined
  // Runs the check and reads the item again; resolves to what it found.
  onCheck: () => Promise<WritingFlag[] | null>
}) {
  const host = useItemHost()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  if (flags !== null && !flags?.length) return null

  async function check() {
    if (checking) return
    setChecking(true)
    setError(null)
    try {
      const found = await onCheck()
      host.say(
        found?.length
          ? `Checked: it breaks ${found.length === 1 ? '1 writing rule' : `${found.length} writing rules`}.`
          : 'Checked: it breaks none of your writing rules.',
      )
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="card">
      {flags === null ? (
        <p>Not checked against your writing rules.</p>
      ) : (
        <>
          <p>
            <span className="badge badge-flagged">Flagged</span>
          </p>
          <WritingFlags flags={flags} name={name} />
        </>
      )}
      {error && <p role="alert">{error.message}</p>}
      <div className="actions">
        {/* aria-disabled, not disabled, so the button keeps focus while it checks. */}
        <button type="button" aria-label={`Check writing rules for ${name}`} aria-disabled={checking} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check writing rules'}
        </button>
      </div>
    </div>
  )
}
