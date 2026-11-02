// Moves focus to an element by id once React has rendered the change that just happened. Used
// when something the user was on goes away (a form closes, an item is deleted), so keyboard
// and screen reader users keep their place instead of landing at the top of the page.
import { useCallback, useEffect, useState } from 'react'

export function useFocusLater() {
  // A new object each time, so asking for the same id twice still moves focus.
  const [request, setRequest] = useState<{ id: string } | null>(null)

  useEffect(() => {
    if (request) document.getElementById(request.id)?.focus()
  }, [request])

  return useCallback((id: string) => setRequest({ id }), [])
}

// The page heading (an h2 with tabIndex={-1}), where focus goes after a delete.
export const PAGE_HEADING_ID = 'page-heading'
