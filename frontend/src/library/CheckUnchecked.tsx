// On the bullet points and narrative content pages: how many texts haven't been checked against
// the writing rules (saved before the check, read from the user's own file, or saved while Claude
// was unreachable), with "Check writing rules", which checks them all at once
// (backend/app/own_text.py, check_unchecked). Text used only by sent versions isn't counted, since
// it went out as it is. Nothing shows when there's none. The page says what it found and moves
// focus to its heading, since the button is gone once they're checked.
import { useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import type { CheckedAll } from '../shared/api/documents'

export default function CheckUnchecked({
  count,
  noun,
  onCheck,
  onDone,
}: {
  count: number
  // Singular and plural, such as ['bullet point', 'bullet points'].
  noun: [string, string]
  onCheck: () => Promise<CheckedAll>
  // Reads the page again, says what was found, and moves focus.
  onDone: (notice: string) => Promise<void>
}) {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  if (count === 0) return null
  const counted = (n: number) => `${n} ${n === 1 ? noun[0] : noun[1]}`

  async function check() {
    if (checking) return
    setChecking(true)
    setError(null)
    try {
      const found = await onCheck()
      const result =
        found.flagged === 0
          ? 'none break your writing rules.'
          : `${found.flagged} ${found.flagged === 1 ? 'breaks' : 'break'} a writing rule, tagged flagged.`
      await onDone(`Checked ${counted(found.checked)}: ${result}`)
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="card">
      <p>
        {counted(count)} {count === 1 ? "isn't" : "aren't"} checked against your writing rules.
      </p>
      {error && <p role="alert">{error.message}</p>}
      <div className="actions">
        {/* aria-disabled, not disabled, so the button keeps focus while it checks. */}
        <button
          type="button"
          aria-label={`Check writing rules for ${counted(count)}`}
          aria-disabled={checking}
          onClick={() => void check()}
        >
          {checking ? 'Checking…' : 'Check writing rules'}
        </button>
      </div>
    </div>
  )
}
