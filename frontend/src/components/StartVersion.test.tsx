import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { Doc } from '../api/documents'
import type { PostingDetail } from '../api/postings'
import { expectNoA11yViolations } from '../test/axe'
import StartVersion from './StartVersion'

const POSTING: PostingDetail = {
  job_posting_id: 9,
  url: 'https://example.com/jobs/1',
  organization: 'Lincoln High',
  role_title: 'English Teacher',
  description: 'Teach ninth grade English.',
  header_id: 2,
  applied_on: null,
  locked: false,
  versions: [],
  updated_at: null,
  suggested_header: null,
  lone_interviews: 0,
  rejected_on: null,
  hired_on: null,
  contacts: null,
  interviews: [],
  same_organization: [],
}
const doc = (id: number, name: string, organization?: string): Doc => ({
  id,
  name,
  header_id: 1,
  tone_set_id: null,
  job_posting: organization ? { job_posting_id: 3, organization, role_title: 'Engineer' } : null,
  based_on: null,
  locked: false,
  copies: [],
  updated_at: null,
})
// Most recently updated first, as the API lists them.
const DOCS = [doc(5, 'Acme resume', 'Acme'), doc(1, 'Tech base')]

function renderStart(onStart = vi.fn(() => Promise.resolve())) {
  render(<StartVersion kind="resume" posting={POSTING} docs={DOCS}onStart={onStart} />)
  return onStart
}

const options = (label: string) =>
  [...screen.getByLabelText(label).querySelectorAll('option')].map((option) => option.textContent)

describe('StartVersion', () => {
  it('opens to a form that starts fresh', async () => {
    const onStart = renderStart()
    const button = screen.getByRole('button', { name: 'Start a resume' })
    await expectNoA11yViolations()
    fireEvent.click(button)
    const name = screen.getByLabelText('Resume name (required)')
    await vi.waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveValue('English Teacher (Lincoln High)')
    expect(screen.getByLabelText('Start from')).toHaveValue('')
    expect(options('Start from')).toEqual(['Fresh, with the usual defaults', 'Tech base', 'Acme resume (for Acme)'])
    // One list, base versions first.
    expect(screen.getByLabelText('Start from').querySelectorAll('optgroup')).toHaveLength(0)
    // The posting's header is used, so there's none to pick.
    expect(screen.queryByLabelText('Header')).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledWith('English Teacher (Lincoln High)', null))
  })

  it('starts from a copy', async () => {
    const onStart = renderStart()
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledWith('English Teacher (Lincoln High)', 5))
  })

  it('says it is starting', async () => {
    renderStart(vi.fn(() => new Promise<void>(() => {})))
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(await screen.findByRole('button', { name: 'Starting…' })).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
  })

  it('highlights the field a refusal names, and cancels back to its button', async () => {
    renderStart(vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'Name is required.', 'name', 422))))
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.')
    const name = screen.getByLabelText('Resume name (required)')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Name is required.')
    await expectNoA11yViolations()
    const form = screen.getByRole('form', { name: 'Start a resume for this posting' })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Start a resume' })).toHaveFocus())
  })
})
