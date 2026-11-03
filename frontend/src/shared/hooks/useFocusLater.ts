// Moves focus to an element by id once React has rendered the change that just happened. Used
// when something the user was on goes away (a form closes, an item is deleted), so keyboard
// and screen reader users keep their place instead of landing at the top of the page.
//
// Nothing behind an open AlertDialog can take focus, so a move asked for while one is open waits
// until it closes (holdFocus), and the alert dialog makes it then.
import { useCallback, useEffect, useState } from 'react'

let alertsOpen = 0
let held: string | null = null

// Called by AlertDialog when it opens. The function it returns, called when it closes, gives the
// id of the last element asked for while it was open, if any.
export function holdFocus() {
  alertsOpen += 1
  return () => {
    alertsOpen -= 1
    const id = held
    held = null
    return id
  }
}

export function useFocusLater() {
  // A new object each time, so asking for the same id twice still moves focus.
  const [request, setRequest] = useState<{ id: string } | null>(null)

  useEffect(() => {
    if (!request) return
    if (alertsOpen > 0) held = request.id
    else document.getElementById(request.id)?.focus()
  }, [request])

  return useCallback((id: string) => setRequest({ id }), [])
}

// The page heading (an h2 with tabIndex={-1}), where focus goes after a delete.
export const PAGE_HEADING_ID = 'page-heading'
