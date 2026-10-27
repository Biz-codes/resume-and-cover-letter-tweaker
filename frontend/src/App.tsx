import { useEffect, useState } from 'react'
import { api, ApiError } from './api/client'

type Status = { state: 'checking' } | { state: 'ok' } | { state: 'error'; message: string }

function App() {
  const [status, setStatus] = useState<Status>({ state: 'checking' })

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
    <main>
      <h1>Resume and Cover Letter Tweaker</h1>
      {status.state === 'checking' && <p>Checking the backend…</p>}
      {status.state === 'ok' && <p>Backend and database are running.</p>}
      {status.state === 'error' && <p role="alert">{status.message}</p>}
    </main>
  )
}

export default App
