import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { usePageTitle } from '../hooks/usePageTitle'

type Status = { state: 'checking' } | { state: 'ok' } | { state: 'error'; message: string }

export default function HomePage() {
  const [status, setStatus] = useState<Status>({ state: 'checking' })
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
      {status.state === 'checking' && <p>Checking the backend…</p>}
      {status.state === 'ok' && <p>Backend and database are running.</p>}
      {status.state === 'error' && <p role="alert">{status.message}</p>}
    </section>
  )
}
