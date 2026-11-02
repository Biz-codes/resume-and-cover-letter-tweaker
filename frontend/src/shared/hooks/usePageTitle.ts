// Sets the browser tab title for the current page (WCAG 2.4.2), e.g. "Skills – Resume Tweaker".
import { useEffect } from 'react'

export const APP_TITLE = 'Resume Tweaker'

export function usePageTitle(page: string | null) {
  useEffect(() => {
    document.title = page ? `${page} – ${APP_TITLE}` : APP_TITLE
  }, [page])
}
