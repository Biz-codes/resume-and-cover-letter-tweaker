import '@testing-library/jest-dom/vitest'
import { act, cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { expectNoA11yViolations } from './axe'

// Match index.html, so whole-page accessibility checks see the same document.
document.documentElement.lang = 'en'
document.title = 'Resume Tweaker'

// Every test that renders something gets an axe check of where it ends up, so no test can
// skip accessibility. Tests still call expectNoA11yViolations for states they pass through
// on the way (loading, a form open before it's saved). Pending fetches and renders settle
// first, so axe never sees a page halfway through an update.
afterEach(async () => {
  if (document.body.childElementCount) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
    await expectNoA11yViolations()
  }
  cleanup()
  vi.unstubAllGlobals()
})
