// A notice another page sends with the move here (`state.notice`: "Claude drafted …", "Deleted
// …"), shown once the page has rendered and App has moved focus to its heading, so OK returns
// focus there. Then it's taken out of the page's history entry (keeping the rest of the state,
// such as `back`), so reloading the page, or coming back to it, doesn't show it again: the browser
// keeps a history entry's state across a reload.
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'

export function useSentNotice(show: (notice: string) => void) {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as { notice?: string } | null
  const sent = state?.notice ?? null
  useEffect(() => {
    if (!sent) return
    const timer = setTimeout(() => {
      show(sent)
      // The same page, so App leaves focus alone.
      const { notice: _shown, ...rest } = state ?? {}
      void navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: Object.keys(rest).length > 0 ? rest : null },
      )
    })
    return () => clearTimeout(timer)
  }, [sent, show, state, navigate, location.pathname, location.search, location.hash])
}
