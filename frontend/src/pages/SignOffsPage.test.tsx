import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SignOff } from '../api/signOffs'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import SignOffsPage from './SignOffsPage'

const SINCERELY: SignOff = {
  sign_off_id: 1,
  text: 'Sincerely',
  used_by: [
    { kind: 'cover_letter', id: 2, name: 'Acme letter', locked: true },
    { kind: 'cover_letter', id: 3, name: 'Draft letter', locked: false },
  ],
}
const BEST: SignOff = { sign_off_id: 4, text: 'Best regards', used_by: [] }

function stub(extra: Record<string, Reply[]> = {}, signOffs = [SINCERELY, BEST]) {
  return stubApi({
    'GET /api/sign-offs': [
      { status: 200, body: signOffs },
      { status: 200, body: signOffs },
    ],
    ...extra,
  })
}

describe('SignOffsPage', () => {
  it('shows each sign-off and the cover letters that use it', async () => {
    stub()
    render(<SignOffsPage />)
    expect(document.title).toBe('Sign-offs – Resume Tweaker')
    const card = (await screen.findByRole('heading', { name: 'Sincerely' })).closest('article') as HTMLElement
    expect(within(card).getByText('Used by (2)')).toBeInTheDocument()
    expect(within(card).getByText('sent')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('adds a sign-off', async () => {
    const fetchMock = stub({ 'POST /api/sign-offs': [{ status: 201, body: { ...BEST, sign_off_id: 5, text: 'Thanks' } }] })
    render(<SignOffsPage />)
    fireEvent.change(await screen.findByLabelText('New sign-off'), { target: { value: 'Thanks' } })
    fireEvent.click(screen.getByText('Add sign-off'))
    expect(await screen.findByRole('status')).toHaveTextContent('Added "Thanks".')
    expect(sentBody(fetchMock, 'POST /api/sign-offs')).toEqual({ text: 'Thanks' })
  })

  it('warns that editing one a sent letter uses saves a new sign-off', async () => {
    const saved = { ...SINCERELY, sign_off_id: 6, text: 'Sincerely yours', used_by: [] }
    const fetchMock = stub({ 'PUT /api/sign-offs/1': [{ status: 200, body: saved }] })
    render(<SignOffsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit "Sincerely"' }))
    const field = screen.getByLabelText('Sign-off')
    expect(field).toHaveFocus()
    expect(field).toHaveAccessibleDescription(/saved as a new sign-off/)
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Sincerely yours' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved as a new sign-off, "Sincerely yours". Sent cover letters keep "Sincerely".',
    )
    expect(sentBody(fetchMock, 'PUT /api/sign-offs/1')).toEqual({ text: 'Sincerely yours' })
  })

  it('shows a validation error on the field, keeping the input', async () => {
    stub({ 'PUT /api/sign-offs/4': [{ status: 422, body: errorBody('VALIDATION_FAILED', 'Text is required.', 'text') }] })
    render(<SignOffsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit "Best regards"' }))
    const field = screen.getByLabelText('Sign-off')
    fireEvent.change(field, { target: { value: ' ' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Text is required.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveValue(' ')
  })

  it('returns focus to Edit when editing is cancelled', async () => {
    stub()
    render(<SignOffsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit "Best regards"' }))
    fireEvent.click(screen.getByText('Cancel'))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit "Best regards"' })).toHaveFocus())
  })

  it('lists what a delete affects, then deletes', async () => {
    stub({ 'DELETE /api/sign-offs/1': [{ status: 204 }] })
    render(<SignOffsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete "Sincerely"' }))
    const confirm = screen.getByRole('group', { name: 'Delete "Sincerely"?' })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    expect(confirm).toHaveTextContent('They keep going with no closing')
    expect(confirm).toHaveTextContent('A sent version uses it')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted "Sincerely".')
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Sign-offs' })).toHaveFocus())
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<SignOffsPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the list fails to load', async () => {
    stub({
      'GET /api/sign-offs': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [BEST] },
      ],
    })
    render(<SignOffsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByRole('heading', { name: 'Best regards' })).toBeInTheDocument()
  })

  it('says when there are no sign-offs yet', async () => {
    stub({}, [])
    render(<SignOffsPage />)
    expect(await screen.findByText('No sign-offs yet.')).toBeInTheDocument()
  })
})
