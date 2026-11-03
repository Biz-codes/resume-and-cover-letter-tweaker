// What a library dialog shows until its item is ready: loading, a failed load with Retry, or
// that the item is gone (deleted elsewhere since the page was read).
import type { ApiError } from '../../shared/api/client'

export default function ItemLoading({
  error,
  missing,
  onRetry,
}: {
  error: ApiError | null
  missing: boolean
  onRetry: () => void
}) {
  if (error) {
    return (
      <div role="alert">
        <p>{error.message}</p>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }
  return <p>{missing ? "It's no longer in your library." : 'Loading…'}</p>
}
