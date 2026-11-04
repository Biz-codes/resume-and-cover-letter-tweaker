import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi } from '../test/stubApi'
import NewPosting from './NewPosting'

const READ = 'POST /api/job-postings/read'
const FOUND = { organization: 'Acme', role_title: 'Engineer', description: 'Build things.' }
const FETCH_FAILED = errorBody('POSTING_FETCH_FAILED', "Couldn't read the job posting. Paste the description in instead.")

function renderForm(onSave = vi.fn(() => Promise.resolve()), onCancel = vi.fn()) {
  render(<NewPosting onSave={onSave} onCancel={onCancel} />)
  return { onSave, onCancel }
}

const link = () => screen.getByLabelText('Link to the posting or primary contact (required)')
const description = () => screen.getByLabelText('Job description')

describe('NewPosting', () => {
  it('reads the posting at the link, then shows what Claude found to check and save', async () => {
    const fetchMock = stubApi({ [READ]: [{ status: 200, body: FOUND }] })
    const { onSave } = renderForm()
    expect(link()).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(link(), { target: { value: 'https://jobs.example.com/1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read posting' }))
    await screen.findByLabelText('Organization (required)')
    const form = screen.getByRole('form', { name: 'New job posting' })
    expect(sentBody(fetchMock, READ)).toEqual({ url: 'https://jobs.example.com/1', text: '' })
    // Focus moves to the first field, which reads the note with it.
    const url = screen.getByLabelText('Link to the posting or primary contact (required)')
    expect(url).toHaveFocus()
    expect(url).toHaveValue('https://jobs.example.com/1')
    expect(url).toHaveAccessibleDescription('Claude filled these in from the posting. Check them before saving.')
    expect(screen.getByLabelText('Organization (required)')).toHaveValue('Acme')
    expect(screen.getByLabelText('Job description (required)')).toHaveValue('Build things.')
    expect(form).toHaveTextContent('Save posting')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Save posting' }))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({ url: 'https://jobs.example.com/1', ...FOUND }))
  })

  it('says it is reading, without disabling the focused button', async () => {
    stubPendingApi()
    renderForm()
    fireEvent.change(link(), { target: { value: 'https://jobs.example.com/1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read posting' }))
    const reading = await screen.findByRole('button', { name: 'Reading…' })
    expect(reading).toHaveAttribute('aria-disabled', 'true')
    expect(reading).toBeEnabled()
    await expectNoA11yViolations()
  })

  it('opens a box for the description when the page can’t be read, then reads that', async () => {
    const fetchMock = stubApi({ [READ]: [{ status: 502, body: FETCH_FAILED }, { status: 200, body: FOUND }] })
    renderForm()
    fireEvent.change(link(), { target: { value: 'https://blocked.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read posting' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Paste the description in instead.')
    // The box takes focus, and reads the message again.
    await vi.waitFor(() => expect(description()).toHaveFocus())
    expect(description()).toHaveAccessibleDescription(/Paste the description in instead/)
    expect(screen.queryByRole('button', { name: 'Paste the description' })).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.change(description(), { target: { value: 'We are hiring.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read posting' }))
    await screen.findByLabelText('Organization (required)')
    expect(sentBody(fetchMock, READ, 1)).toEqual({ url: 'https://blocked.example.com', text: 'We are hiring.' })
  })

  it('keeps focus in the box when the pasted text can’t be read either', async () => {
    stubApi({ [READ]: [{ status: 502, body: FETCH_FAILED }] })
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Paste the description' }))
    expect(description()).toHaveFocus()
    await expectNoA11yViolations()
    screen.getByRole('button', { name: 'Read posting' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Read posting' }))
    await screen.findByRole('alert')
    expect(description()).toHaveFocus()
  })

  it('offers Retry when Claude isn’t available, keeping what was typed', async () => {
    stubApi({
      [READ]: [
        { status: 503, body: errorBody('AI_UNAVAILABLE', "Claude isn't available right now. Try again in a moment.") },
        { status: 200, body: FOUND },
      ],
    })
    renderForm()
    fireEvent.change(link(), { target: { value: 'https://jobs.example.com/1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read posting' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Claude isn't available")
    expect(link()).toHaveValue('https://jobs.example.com/1')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Organization (required)')).toHaveValue('Acme')
  })

  it('highlights the link when it isn’t a web address and nothing was pasted', async () => {
    stubApi({
      [READ]: [{ status: 422, body: errorBody('VALIDATION_FAILED', 'Enter a web address starting with http:// or https://, or paste the description in.', 'url') }],
    })
    renderForm()
    fireEvent.change(link(), { target: { value: 'Jamie Lee' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read posting' }))
    await screen.findByRole('alert')
    expect(link()).toHaveAttribute('aria-invalid', 'true')
    expect(link()).toHaveAccessibleDescription(/Enter a web address/)
    await expectNoA11yViolations()
  })

  it('fills in by hand without Claude, keeping what was typed', async () => {
    const fetchMock = stubApi({})
    renderForm()
    fireEvent.change(link(), { target: { value: 'Jamie Lee, jamie@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Paste the description' }))
    fireEvent.change(description(), { target: { value: 'Teach ninth grade.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fill in by hand' }))
    const url = screen.getByLabelText('Link to the posting or primary contact (required)')
    expect(url).toHaveFocus()
    expect(url).not.toHaveAccessibleDescription()
    expect(screen.getByLabelText('Job description (required)')).toHaveValue('Teach ninth grade.')
    expect(fetchMock).not.toHaveBeenCalled()
    await expectNoA11yViolations()
  })

  it('cancels from either step', () => {
    const { onCancel } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fill in by hand' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
