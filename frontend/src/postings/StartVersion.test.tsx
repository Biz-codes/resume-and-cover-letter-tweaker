import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../shared/api/client'
import type { Doc } from '../shared/api/documents'
import { expectNoA11yViolations } from '../test/axe'
import StartVersion from './StartVersion'

const doc = (id: number, name: string, organization?: string): Doc => ({
  id,
  name,
  header_id: 1,
  tone_set_id: null,
  job_posting: organization ? { job_posting_id: 3, organization, role_title: 'Engineer' } : null,
  based_on: null,
  locked: false,
  hidden: false,
  copies: [],
  updated_at: null,
})
// Most recently updated first, as the API lists them.
const DOCS = [doc(5, 'Acme resume', 'Acme'), doc(1, 'Tech')]

function renderStart(onStart = vi.fn(() => Promise.resolve())) {
  render(<StartVersion kind="resume" docs={DOCS} onStart={onStart} />)
  return onStart
}

const options = (label: string) =>
  [...screen.getByLabelText(label).querySelectorAll('option')].map((option) => option.textContent)

describe('StartVersion', () => {
  it("doesn't offer hidden ones to start from", () => {
    render(<StartVersion kind="resume" docs={[...DOCS, { ...doc(7, 'Old resume'), hidden: true }]} onStart={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    expect(options('Start from')).toEqual(['Fresh, with the usual defaults', 'Tech Base Resume', 'Acme resume (for Acme)'])
  })

  it('opens to a form that starts fresh', async () => {
    const onStart = renderStart()
    const button = screen.getByRole('button', { name: 'Start a resume' })
    await expectNoA11yViolations()
    fireEvent.click(button)
    const from = screen.getByLabelText('Start from')
    await vi.waitFor(() => expect(from).toHaveFocus())
    expect(from).toHaveValue('')
    // It's named for the posting, so there's no name to type.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(options('Start from')).toEqual(['Fresh, with the usual defaults', 'Tech Base Resume', 'Acme resume (for Acme)'])
    // One list, base versions first.
    expect(screen.getByLabelText('Start from').querySelectorAll('optgroup')).toHaveLength(0)
    // The posting's header is used, so there's none to pick.
    expect(screen.queryByLabelText('Header')).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledWith(null))
  })

  it('starts from a copy', async () => {
    const onStart = renderStart()
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledWith(5))
  })

  it('says it is starting', async () => {
    renderStart(vi.fn(() => new Promise<void>(() => {})))
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(await screen.findByRole('button', { name: 'Starting…' })).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
  })

  it('shows a refusal, and cancels back to its button', async () => {
    renderStart(vi.fn(() => Promise.reject(new ApiError('VERSION_LOCKED', 'This version was already sent.', null, 409))))
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This version was already sent.')
    await expectNoA11yViolations()
    const form = screen.getByRole('form', { name: 'Start a resume for this posting' })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Start a resume' })).toHaveFocus())
  })
})
