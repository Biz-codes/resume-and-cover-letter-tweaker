import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SignOff } from '../shared/api/signOffs'
import { expectNoA11yViolations } from '../test/axe'
import { loadedDialog, openItem } from '../test/openCard'
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
    const card = await openItem('Sincerely')
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
    await loadedDialog()
    const field = screen.getByLabelText('Sign-off')
    expect(field).toHaveAccessibleDescription(/A sent version uses this sign-off, so saving adds a new one/)
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
    await loadedDialog()
    const field = screen.getByLabelText('Sign-off')
    fireEvent.change(field, { target: { value: ' ' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Text is required.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveValue(' ')
  })

  it('closes the dialog and returns focus to Edit when editing is cancelled', async () => {
    stub()
    render(<SignOffsPage />)
    const edit = await screen.findByRole('button', { name: 'Edit "Best regards"' })
    edit.focus()
    fireEvent.click(edit)
    fireEvent.click(within(await loadedDialog()).getByText('Cancel'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(edit).toHaveFocus()
  })

  it('adds a new version of a sign-off', async () => {
    const version = { ...SINCERELY, sign_off_id: 7, text: 'Sincerely yours', used_by: [] }
    const fetchMock = stub({ 'POST /api/sign-offs/1/versions': [{ status: 201, body: version }] })
    render(<SignOffsPage />)
    fireEvent.click(within(await openItem('Sincerely')).getByRole('button', { name: 'New version' }))
    const field = screen.getByLabelText("New version's sign-off")
    expect(field).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Sincerely yours' } })
    fireEvent.click(screen.getByText('Add version'))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added "Sincerely yours". Cover letters keep "Sincerely" until you pick the new one.',
    )
    expect(sentBody(fetchMock, 'POST /api/sign-offs/1/versions')).toEqual({ text: 'Sincerely yours' })
  })

  it('lists what a delete affects, then deletes', async () => {
    stub({ 'DELETE /api/sign-offs/1': [{ status: 204 }] })
    render(<SignOffsPage />)
    fireEvent.click(within(await openItem('Sincerely')).getByRole('button', { name: 'Delete' }))
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
