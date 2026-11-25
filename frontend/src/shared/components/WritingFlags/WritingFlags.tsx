// The writing rules some text breaks (backend/app/writing_check.py), each with the words that break
// it and why: Claude's text still breaking one after the check's fix, or the user's own wording,
// which is never changed. Used by Claude's draft, the chat's proposal cards, a review's fixes, and an
// item's dialog. Nothing shows when it breaks none.
//
// With `onDismiss`, the user can dismiss a flag that doesn't apply (backend/app/flag_dismissal.py):
// it stops counting (no "Flagged" badge once none is left) and moves under "Dismissed flags (n)",
// closed to start, where Restore brings it back. Focus goes to the next flag's Dismiss (the one
// before, at the end), or to "Dismissed flags" once none is left; after Restore, to the flag's
// Dismiss. Each is said through `say` (a dialog's notice), or this list's own live region.
// Without `onDismiss` (a record, or something that can't change), dismissed flags are only shown
// apart.
import { useId, useState } from 'react'
import { toApiError, type ApiError } from '../../api/client'
import type { WritingFlag } from '../../api/documents'
import { useFocusLater } from '../../hooks/useFocusLater'
import Disclosure from '../Disclosure/Disclosure'
import styles from './WritingFlags.module.css'

function Flag({ flag }: { flag: WritingFlag }) {
  return (
    <span>
      <strong>{flag.rule}</strong>: &ldquo;{flag.quote}&rdquo;. {flag.why}
    </span>
  )
}

export default function WritingFlags({
  flags,
  name,
  onDismiss,
  say,
}: {
  flags?: WritingFlag[]
  // The text, for the lists' and buttons' names.
  name: string
  // Saves the flag dismissed (true) or restored (false); rejects with what went wrong.
  onDismiss?: (flag: WritingFlag, dismissed: boolean) => Promise<void>
  // Says what changed somewhere else (a dialog's notice) instead of this list's live region.
  say?: (text: string) => void
}) {
  const base = useId()
  const focusLater = useFocusLater()
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [said, setSaid] = useState('')
  if (!flags?.length) return null

  // Each flag keeps its place in `flags` (dismissing never reorders them), so its index names it.
  const indexed = flags.map((flag, index) => ({ flag, index }))
  const shown = indexed.filter(({ flag }) => !flag.dismissed)
  const gone = indexed.filter(({ flag }) => flag.dismissed)
  const dismissId = (index: number) => `${base}-dismiss-${index}`
  const dismissedId = `${base}-dismissed`

  async function change(flag: WritingFlag, index: number, dismissed: boolean) {
    if (!onDismiss || busy !== null) return
    setBusy(index)
    setError(null)
    try {
      await onDismiss(flag, dismissed)
      const message = `${dismissed ? 'Dismissed' : 'Restored'} the flag "${flag.rule}" on ${name}.`
      if (say) say(message)
      else setSaid(message)
      if (dismissed) {
        const at = shown.findIndex((entry) => entry.index === index)
        const next = shown[at + 1] ?? shown[at - 1]
        focusLater(next ? dismissId(next.index) : dismissedId)
      } else {
        focusLater(dismissId(index))
      }
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.writingFlags}>
      {shown.length > 0 && (
        <ul aria-label={`Writing rules ${name} breaks`} className={styles.flags}>
          {shown.map(({ flag, index }) => (
            <li key={index}>
              <Flag flag={flag} />
              {onDismiss && (
                // aria-disabled, not disabled, so the button keeps focus while it saves.
                <button
                  type="button"
                  id={dismissId(index)}
                  aria-label={`Dismiss flag "${flag.rule}" on ${name}`}
                  aria-disabled={busy !== null}
                  onClick={() => void change(flag, index, true)}
                >
                  Dismiss
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {gone.length > 0 && (
        <Disclosure
          id={dismissedId}
          title={
            <>
              {/* The space is outside the hidden part, so the name keeps it. */}
              Dismissed flags ({gone.length}) <span className="visually-hidden">on {name}</span>
            </>
          }
        >
          <ul aria-label={`Dismissed flags on ${name}`} className={styles.dismissed}>
            {gone.map(({ flag, index }) => (
              <li key={index}>
                <Flag flag={flag} />
                {onDismiss && (
                  <button
                    type="button"
                    aria-label={`Restore flag "${flag.rule}" on ${name}`}
                    aria-disabled={busy !== null}
                    onClick={() => void change(flag, index, false)}
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {error && <p role="alert">{error.message}</p>}
      {onDismiss && !say && (
        // A plain live region rather than role="status", so the page's notices stay in AlertDialog.
        <p aria-live="polite" className="visually-hidden">
          {said}
        </p>
      )}
    </div>
  )
}
