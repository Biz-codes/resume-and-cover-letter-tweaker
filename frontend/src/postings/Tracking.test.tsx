import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../shared/api/client'
import type { PostingDetail } from './postings'
import { expectNoA11yViolations } from '../test/axe'
import Tracking from './Tracking'

const POSTING: PostingDetail = {
  job_posting_id: 9,
  url: 'https://example.com/jobs/9',
  organization: 'Lincoln High',
  role_title: 'English Teacher',
  description: 'Teach.',
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
const APPLIED = { ...POSTING, applied_on: '2026-10-01', locked: true, rejected_on: '2026-10-20', contacts: 'Pat Lee\npat@example.com' }

function renderTracking(posting = POSTING, onSave = vi.fn(() => Promise.resolve())) {
  render(<Tracking posting={posting} onSave={onSave} />)
  return onSave
}

const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit tracking' }))
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

describe('Tracking', () => {
  it('says when nothing is recorded, and records an applied date', async () => {
    const onSave = renderTracking()
    expect(screen.getByText('No dates or contacts yet.')).toBeInTheDocument()
    await expectNoA11yViolations()
    edit()
    const applied = screen.getByLabelText('Applied on')
    await vi.waitFor(() => expect(applied).toHaveFocus())
    expect(applied).toHaveAccessibleDescription("An applied date locks this posting's resume and cover letter.")
    await expectNoA11yViolations()
    fireEvent.change(applied, { target: { value: '2026-10-01' } })
    save()
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ applied_on: '2026-10-01', rejected_on: null, hired_on: null, contacts: null }),
    )
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit tracking' })).toHaveFocus())
  })

  it('shows what is recorded, in words', () => {
    renderTracking(APPLIED)
    expect(screen.getByText('October 1, 2026')).toBeInTheDocument()
    expect(screen.getByText('October 20, 2026')).toBeInTheDocument()
    expect(screen.getByText(/pat@example.com/)).toBeInTheDocument()
    expect(screen.queryByText('Hired on')).not.toBeInTheDocument()
  })

  it('changes other details of an applied posting without asking', async () => {
    const onSave = renderTracking(APPLIED)
    edit()
    expect(screen.queryByText(/locks this posting/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Hired on'), { target: { value: '2026-11-01' } })
    save()
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: 'Clear the applied date?' })).not.toBeInTheDocument()
  })

  it('asks before clearing the applied date', async () => {
    const onSave = renderTracking(APPLIED)
    edit()
    fireEvent.change(screen.getByLabelText('Applied on'), { target: { value: '' } })
    save()
    const confirm = await screen.findByRole('group', { name: 'Clear the applied date?' })
    expect(confirm).toHaveTextContent('can be changed again')
    expect(onSave).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Clear the date' }))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ applied_on: null, rejected_on: '2026-10-20' })))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit tracking' })).toHaveFocus())
  })

  it('goes back to the form with the date restored, keeping other changes', async () => {
    renderTracking(APPLIED)
    edit()
    fireEvent.change(screen.getByLabelText('Applied on'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Contacts'), { target: { value: 'Jo Park' } })
    save()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    const applied = screen.getByLabelText('Applied on')
    expect(applied).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('Contacts')).toHaveValue('Jo Park')
    await vi.waitFor(() => expect(applied).toHaveFocus())
  })

  it('shows a failed clear, and a failed save in the form', async () => {
    const onSave = vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'That date is not valid.', 'hired_on', 422)))
    renderTracking(APPLIED, onSave)
    edit()
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('That date is not valid.')
    expect(screen.getByLabelText('Hired on')).toHaveAttribute('aria-invalid', 'true')
    await expectNoA11yViolations()
    fireEvent.change(screen.getByLabelText('Applied on'), { target: { value: '' } })
    save()
    fireEvent.click(await screen.findByRole('button', { name: 'Clear the date' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That date is not valid.')
    await expectNoA11yViolations()
  })

  it('cancels back to its button', async () => {
    renderTracking()
    edit()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit tracking' })).toHaveFocus())
  })
})
