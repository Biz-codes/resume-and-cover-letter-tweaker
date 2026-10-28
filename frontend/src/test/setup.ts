import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Match index.html, so whole-page accessibility checks see the same document.
document.documentElement.lang = 'en'
document.title = 'Resume Tweaker'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
