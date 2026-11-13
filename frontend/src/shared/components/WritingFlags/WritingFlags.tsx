// The writing rules some text breaks (backend/app/writing_check.py), each with the words that break
// it and why: Claude's text still breaking one after the check's fix, or the user's own wording,
// which is never changed. Used by Claude's draft, the chat's proposal cards, and an item dialog's
// "Ask Claude". Nothing shows when it breaks none.
import type { WritingFlag } from '../../api/documents'
import styles from './WritingFlags.module.css'

export default function WritingFlags({ flags, name }: { flags?: WritingFlag[]; name: string }) {
  if (!flags?.length) return null
  return (
    <ul aria-label={`Writing rules ${name} breaks`} className={styles.flags}>
      {flags.map((flag) => (
        <li key={`${flag.kind}:${flag.rule}`}>
          <strong>{flag.rule}</strong>: &ldquo;{flag.quote}&rdquo;. {flag.why}
        </li>
      ))}
    </ul>
  )
}
