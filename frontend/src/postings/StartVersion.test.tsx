import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../shared/api/client'
import type { Doc } from '../shared/api/documents'
import type { ToneSet } from '../shared/api/toneSets'
import { expectNoA11yViolations } from '../test/axe'
import { sentBody, stubApi } from '../test/stubApi'
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
const TONES = [
  { tone_set_id: 2, name: 'Warm', hidden: false, created_at: '2026-10-01T00:00:00Z' },
  { tone_set_id: 3, name: 'Old', hidden: true, created_at: '2026-10-01T00:00:00Z' },
] as ToneSet[]

function renderStart(onStart = vi.fn(() => Promise.resolve()), docs = DOCS) {
  render(<StartVersion kind="resume" postingId={9} docs={docs} toneSets={TONES} onToneSaved={vi.fn()} onStart={onStart} />)
  fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
  return onStart
}

const options = (label: string) =>
  [...screen.getByLabelText(label).querySelectorAll('option')].map((option) => option.textContent)

describe('StartVersion', () => {
  it('opens to Claude tailoring it, with a tone', async () => {
    render(<StartVersion kind="resume" postingId={9} docs={DOCS} toneSets={TONES} onToneSaved={vi.fn()} onStart={vi.fn()} />)
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    const claude = screen.getByRole('radio', { name: 'Claude tailors one of your saved resumes' })
    await vi.waitFor(() => expect(claude).toHaveFocus())
    expect(claude).toBeChecked()
    expect(screen.getAllByRole('radio').map((radio) => radio.parentElement?.textContent)).toEqual([
      'Claude tailors one of your saved resumes',
      'Copy a saved resume as is',
      'Build from scratch (empty)',
      'Upload a resume (PDF or Word)',
      "Paste a resume's text",
    ])
    // Hidden tones aren't offered, and Claude can pick one. It's named for the posting, and uses its
    // header.
    expect(options('Tone')).toEqual(['Let Claude pick', 'None', 'Warm'])
    expect(screen.getByRole('button', { name: 'Suggest a new tone' })).toBeInTheDocument()
    // With no default given, it starts on None.
    expect(screen.getByLabelText('Tone')).toHaveValue('')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Header')).not.toBeInTheDocument()
    // Claude picks the starting point unless one is chosen.
    expect(options('Start from')).toEqual(['The best fit (Claude picks)', 'Tech Base Resume', 'Acme resume (for Acme)'])
    await expectNoA11yViolations()
  })

  it('has Claude tailor it, saying so while it waits', async () => {
    const onStart = renderStart(vi.fn(() => new Promise<void>(() => {})))
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(onStart).toHaveBeenCalledWith({ how: 'claude', toneSetId: 2, startFromId: null, pickTone: false })
    expect(await screen.findByRole('button', { name: 'Tailoring…' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Claude is tailoring your resume. This can take a few minutes.')).toHaveAttribute('aria-live', 'polite')
    await expectNoA11yViolations()
  })

  it('has Claude tailor the one chosen, and points to it when it has nothing to start from', async () => {
    const onStart = renderStart(
      vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'That resume has nothing in it to start from.', 'start_from_id', 422))),
    )
    const from = screen.getByLabelText('Start from')
    fireEvent.change(from, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(onStart).toHaveBeenCalledWith({ how: 'claude', toneSetId: null, startFromId: 1, pickTone: false })
    expect(await screen.findByRole('alert')).toHaveTextContent('That resume has nothing in it to start from.')
    expect(from).toHaveAttribute('aria-invalid', 'true')
    expect(from).toHaveAccessibleDescription('That resume has nothing in it to start from.')
    await vi.waitFor(() => expect(from).toHaveFocus())
    await expectNoA11yViolations()
  })

  it('copies a saved one, base versions first, without hidden ones', async () => {
    const onStart = renderStart(undefined, [...DOCS, { ...doc(7, 'Old resume'), hidden: true }])
    fireEvent.click(screen.getByRole('radio', { name: 'Copy a saved resume as is' }))
    // A copy keeps the original's tone.
    expect(screen.queryByLabelText('Tone')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suggest a new tone' })).not.toBeInTheDocument()
    expect(options('Start from')).toEqual(['Choose a resume', 'Tech Base Resume', 'Acme resume (for Acme)'])
    await expectNoA11yViolations()
    // One has to be chosen first.
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a resume to copy.')
    const from = screen.getByLabelText('Start from')
    expect(from).toHaveAttribute('aria-invalid', 'true')
    expect(from).toHaveAccessibleDescription('Choose a resume to copy.')
    await vi.waitFor(() => expect(from).toHaveFocus())
    expect(onStart).not.toHaveBeenCalled()
    await expectNoA11yViolations()
    fireEvent.change(from, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(onStart).toHaveBeenCalledWith({ how: 'copy', fromId: 5 })
    expect(await screen.findByRole('button', { name: 'Starting…' })).toBeInTheDocument()
    expect(screen.queryByText(/Claude is tailoring/)).not.toBeInTheDocument()
  })

  it('builds one from scratch', () => {
    const onStart = renderStart()
    fireEvent.click(screen.getByRole('radio', { name: 'Build from scratch (empty)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(onStart).toHaveBeenCalledWith({ how: 'scratch', toneSetId: null })
  })

  it('shows a failure to try again, and cancels back to its button', async () => {
    const onStart = renderStart(vi.fn(() => Promise.reject(new ApiError('AI_UNAVAILABLE', "Claude isn't available.", null, 503))))
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Claude isn't available.")
    // Claude failing offers to try again, as reading a posting does.
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('aria-disabled', 'false')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onStart).toHaveBeenCalledTimes(2)
    await screen.findByRole('alert')
    const form = screen.getByRole('form', { name: 'Start a resume for this posting' })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Start a resume' })).toHaveFocus())
  })

  it('reads an uploaded one, then saves what the user checked', async () => {
    const read = {
      header: null,
      header_saved: false,
      sections: [{ values: { title: 'Summary' }, saved: true, similar: null, entries: [] }],
      addressee: null,
      sign_off: null,
      signature_name: null,
    }
    const fetchMock = stubApi({ 'POST /api/resumes/read': [{ status: 200, body: read }] })
    const onStart = renderStart()
    fireEvent.click(screen.getByRole('radio', { name: 'Upload a resume (PDF or Word)' }))
    // It takes a tone, for Claude's tailoring and the resume.
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: '2' } })
    const input = screen.getByLabelText('Resume file, PDF or Word (required)')
    fireEvent.click(screen.getByRole('button', { name: 'Read resume' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a resume file to upload.')
    await vi.waitFor(() => expect(input).toHaveFocus())
    expect(input).toHaveAccessibleDescription('Choose a resume file to upload.')
    await expectNoA11yViolations()
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'me.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read resume' }))
    const review = await screen.findByRole('form', { name: 'Check the resume Claude read' })
    expect(sentBody(fetchMock, 'POST /api/resumes/read')).toEqual({ file: { name: 'me.pdf', data: btoa('%PDF') } })
    fireEvent.click(within(review).getByRole('button', { name: 'Save as is' }))
    expect(onStart).toHaveBeenCalledWith({
      how: 'imported',
      toneSetId: 2,
      tailor: false,
      body: {
        header: null,
        sections: [{ item_id: null, values: { title: 'Summary' }, entries: [] }],
        addressee: null,
        sign_off: null,
        signature_name: null,
      },
    })
  })

  it('cancels a review back to its button', async () => {
    stubApi({
      'POST /api/resumes/read': [
        {
          status: 200,
          body: { header: null, header_saved: false, sections: [], addressee: null, sign_off: null, signature_name: null },
        },
      ],
    })
    renderStart()
    fireEvent.click(screen.getByRole('radio', { name: "Paste a resume's text" }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Resume text (required)' }), { target: { value: 'Sam' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read resume' }))
    const review = await screen.findByRole('form', { name: 'Check the resume Claude read' })
    fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Start a resume' })).toHaveFocus())
  })

  it('starts on the default tone, and still offers None', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    render(<StartVersion kind="resume" postingId={9} docs={DOCS} toneSets={TONES} defaultTone={TONES[0].tone_set_id} onToneSaved={vi.fn()} onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    expect(screen.getByLabelText('Tone')).toHaveValue(String(TONES[0].tone_set_id))
    await expectNoA11yViolations()
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Build from scratch (empty)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledWith({ how: 'scratch', toneSetId: null }))
  })

  it('lets Claude pick the tone, only when Claude tailors it', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    render(<StartVersion kind="resume" postingId={9} docs={DOCS} toneSets={TONES} defaultTone={2} onToneSaved={vi.fn()} onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start a resume' }))
    const tone = screen.getByLabelText('Tone')
    fireEvent.change(tone, { target: { value: 'claude' } })
    // Building from scratch has no Claude to pick, so it goes back to the default.
    fireEvent.click(screen.getByRole('radio', { name: 'Build from scratch (empty)' }))
    expect(screen.getByLabelText('Tone')).toHaveValue('2')
    expect(options('Tone')).toEqual(['None', 'Warm'])
    expect(screen.queryByRole('button', { name: 'Suggest a new tone' })).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('radio', { name: 'Claude tailors one of your saved resumes' }))
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: 'claude' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start resume' }))
    expect(onStart).toHaveBeenCalledWith({ how: 'claude', toneSetId: null, startFromId: null, pickTone: true })
  })

  it("opens Claude's suggested tone in place of the form, and picks the tone once it's saved", async () => {
    const saved = { tone_set_id: 8, name: 'Startup', hidden: false, created_at: '2026-11-16T00:00:00Z' } as ToneSet
    const fetchMock = stubApi({
      'POST /api/tone-sets/suggested': [{ status: 200, body: { name: 'Startup', reason: 'A small team.', rules: [] } }],
      'GET /api/tone-rules': [{ status: 200, body: [] }],
      'POST /api/tone-sets': [{ status: 201, body: saved }],
    })
    const onToneSaved = vi.fn()
    // The page adds the saved tone to its list.
    function Page() {
      const [tones, setTones] = useState(TONES)
      return (
        <StartVersion
          kind="cover_letter"
          postingId={9}
          docs={DOCS}
          toneSets={tones}
          onToneSaved={async (toneSet) => {
            onToneSaved(toneSet)
            setTones([...tones, toneSet])
          }}
          onStart={vi.fn()}
        />
      )
    }
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: 'Start a cover letter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a new tone' }))
    expect(screen.queryByRole('form', { name: 'Start a cover letter for this posting' })).not.toBeInTheDocument()
    const name = await screen.findByRole('textbox', { name: 'Tone name' })
    expect(sentBody(fetchMock, 'POST /api/tone-sets/suggested')).toEqual({ job_posting_id: 9, kind: 'cover_letter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save tone' }))
    await vi.waitFor(() => expect(onToneSaved).toHaveBeenCalledWith(saved))
    // Back on the form, which kept its choices, with the new tone picked and focused.
    const tone = await screen.findByLabelText('Tone')
    expect(tone).toHaveValue('8')
    await vi.waitFor(() => expect(tone).toHaveFocus())
    expect(name).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('cancels a suggested tone back to its button', async () => {
    stubApi({
      'POST /api/tone-sets/suggested': [{ status: 200, body: { name: 'Startup', reason: 'A small team.', rules: [] } }],
      'GET /api/tone-rules': [{ status: 200, body: [] }],
    })
    renderStart()
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a new tone' }))
    await screen.findByRole('textbox', { name: 'Tone name' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Suggest a new tone' })).toHaveFocus())
    expect(screen.getByLabelText('Tone')).toHaveValue('2')
  })
})
