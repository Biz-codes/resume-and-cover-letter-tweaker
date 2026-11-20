import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { useSentNotice } from './useSentNotice'

function Page() {
  const [notice, setNotice] = useState<string | null>(null)
  useSentNotice(setNotice)
  const { state } = useLocation()
  return (
    <>
      <p>Notice: {notice ?? 'none'}</p>
      <p>State: {JSON.stringify(state)}</p>
    </>
  )
}

function renderAt(state: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/resumes/1', state }]}>
      <Routes>
        <Route path="/resumes/:id" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('useSentNotice', () => {
  it('shows the notice once, then takes it out of the history entry, keeping the rest', async () => {
    renderAt({ notice: 'Claude drafted "Resume".', back: '/postings/3' })
    expect(await screen.findByText('Notice: Claude drafted "Resume".')).toBeInTheDocument()
    // A reload reads the entry's state again, which no longer has the notice.
    await vi.waitFor(() => expect(screen.getByText('State: {"back":"/postings/3"}')).toBeInTheDocument())
    expect(screen.getByText('Notice: Claude drafted "Resume".')).toBeInTheDocument()
  })

  it('leaves no state when the notice was all of it', async () => {
    renderAt({ notice: 'Deleted "Old".' })
    expect(await screen.findByText('Notice: Deleted "Old".')).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByText('State: null')).toBeInTheDocument())
  })

  it('does nothing without a notice', async () => {
    renderAt({ back: '/postings/3' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.getByText('Notice: none')).toBeInTheDocument()
    expect(screen.getByText('State: {"back":"/postings/3"}')).toBeInTheDocument()
  })
})
