// Home: asks what the user wants to do, one choice per mode (src/modes.ts), and shows whether
// the backend is running.
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api/client'
import { PAGE_HEADING_ID } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'
import { MODES } from '../modes'

type Status = { state: 'checking' } | { state: 'ok' } | { state: 'error'; message: string }

export default function HomePage() {
  const [status, setStatus] = useState<Status>({ state: 'checking' })
  const id = useId()
  usePageTitle(null)

  useEffect(() => {
    api
      .get<{ status: string }>('/health')
      .then(() => setStatus({ state: 'ok' }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : String(error)
        setStatus({ state: 'error', message })
      })
  }, [])

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        What do you want to do?
      </h2>
      <ul className="choices">
        {/* Each link is described by its tag and description, so moving from link to link
            still says which ones are coming soon. */}
        {MODES.map((mode, index) => (
          <li key={mode.path}>
            <Link
              to={mode.path}
              aria-describedby={[mode.comingIn && `${id}-tag-${index}`, `${id}-description-${index}`]
                .filter(Boolean)
                .join(' ')}
            >
              {mode.action}
            </Link>
            {mode.comingIn && (
              <span className="tag" id={`${id}-tag-${index}`}>
                coming soon
              </span>
            )}
            <p className="muted" id={`${id}-description-${index}`}>
              {mode.description}
            </p>
          </li>
        ))}
      </ul>
      {status.state === 'checking' && <p className="muted">Checking the backend…</p>}
      {status.state === 'ok' && <p className="muted">Backend and database are running.</p>}
      {status.state === 'error' && <p role="alert">{status.message}</p>}
    </section>
  )
}
