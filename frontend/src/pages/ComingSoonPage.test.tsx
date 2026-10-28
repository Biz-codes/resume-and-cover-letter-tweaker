import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MODES } from '../modes'
import ComingSoonPage from './ComingSoonPage'

describe('ComingSoonPage', () => {
  it('names the mode and says when it is coming', () => {
    const resumes = MODES.find((mode) => mode.path === '/resumes')!
    render(<ComingSoonPage mode={resumes} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Resumes' })).toBeInTheDocument()
    expect(screen.getByText('Coming in phase 4.')).toBeInTheDocument()
    expect(document.title).toBe('Resumes – Resume Tweaker')
  })
})
