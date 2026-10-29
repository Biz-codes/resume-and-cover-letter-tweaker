import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MODES } from '../modes'
import ComingSoonPage from './ComingSoonPage'

describe('ComingSoonPage', () => {
  it('names the mode and says when it is coming', () => {
    const postings = MODES.find((mode) => mode.path === '/postings')!
    render(<ComingSoonPage mode={postings} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Job postings' })).toBeInTheDocument()
    expect(screen.getByText('Coming in phase 4.')).toBeInTheDocument()
    expect(document.title).toBe('Job postings – Resume Tweaker')
  })
})
