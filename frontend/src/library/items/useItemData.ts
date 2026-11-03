// The lists a view in a library dialog reads (the item's own list, and what it can add), and
// `load` to read them again after a change.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'

export function useItemData<T>(read: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const reader = useRef(read)

  const load = useCallback(
    () =>
      reader
        .current()
        .then((next) => {
          setData(next)
          setError(null)
        })
        .catch((caught: unknown) => setError(toApiError(caught))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  return { data, error, load }
}
