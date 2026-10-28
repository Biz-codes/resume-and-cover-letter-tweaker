// The page for a mode that isn't built yet, so Home and the nav can show the whole app.
import type { Mode } from '../modes'
import { PAGE_HEADING_ID } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

export default function ComingSoonPage({ mode }: { mode: Mode }) {
  usePageTitle(mode.name)
  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        {mode.name}
      </h2>
      <p>{mode.description}</p>
      <p className="muted">Coming in {mode.comingIn}.</p>
    </section>
  )
}
