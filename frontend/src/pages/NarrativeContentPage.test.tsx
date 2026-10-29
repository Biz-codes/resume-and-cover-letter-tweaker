import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NarrativeContent } from '../api/narrativeContent'
import type { Section } from '../api/sections'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import NarrativeContentPage from './NarrativeContentPage'

const SENT = { kind: 'cover_letter' as const, id: 2, name: 'Acme letter', locked: true }
const INTRO: NarrativeContent = {
  content_id: 10,
  content: 'I build tools that help teachers spend more time with students.',
  sections: [
    { id: 1, title: 'Summary' },
    { id: 8, title: 'Intro paragraph' },
  ],
  used_by: [SENT],
}
const LOOSE: NarrativeContent = { ...INTRO, content_id: 11, content: 'Thank you for reading.', sections: [], used_by: [] }
const LABEL = '"I build tools that help teachers…"'

function section(id: number, title: string): Section {
  return {
    id,
    title,
    built_in: id === 1,
    narrative_content: [],
    skill_categories: [],
    experience: [],
    projects: [],
    bullets: [],
    education: [],
    used_by: [],
  }
}
const SECTIONS = [section(1, 'Summary'), section(8, 'Intro paragraph'), section(9, 'Outro')]

function stub(extra: Record<string, Reply[]> = {}, excerpts = [INTRO, LOOSE]) {
  return stubApi({
    'GET /api/narrative-content': [
      { status: 200, body: excerpts },
      { status: 200, body: excerpts },
    ],
    'GET /api/sections': [
      { status: 200, body: SECTIONS },
      { status: 200, body: SECTIONS },
    ],
    ...extra,
  })
}

describe('NarrativeContentPage', () => {
  it('shows the sections that list each excerpt, unlisted excerpts first', async () => {
    stub()
    render(<NarrativeContentPage />)
    expect(document.title).toBe('Narrative content – Resume Tweaker')
    expect(screen.getByText(/anything from one sentence to a full paragraph, grouped however you choose/)).toBeInTheDocument()
    expect(screen.getByText(/Write new excerpts here OR on the Sections page/)).toBeInTheDocument()
    const card = (await screen.findByRole('heading', { name: INTRO.content })).closest('article') as HTMLElement
    expect(within(card).getByText('Sections (2)')).toBeInTheDocument()
    expect(within(card).getByText('Intro paragraph')).toBeInTheDocument()
    const unlisted = screen.getByRole('heading', { name: 'Not listed anywhere' })
    expect(unlisted.parentElement).toHaveTextContent('Thank you for reading.')
    await expectNoA11yViolations()
  })

  it('warns that editing an excerpt a sent version uses saves a new excerpt', async () => {
    const saved = { ...INTRO, content_id: 12, content: 'I build tools.', used_by: [] }
    const fetchMock = stub({ 'PUT /api/narrative-content/10': [{ status: 200, body: saved }] })
    render(<NarrativeContentPage />)
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${LABEL}` }))
    const field = screen.getByLabelText('Narrative content text (required)')
    expect(field).toHaveFocus()
    expect(field).toHaveAccessibleDescription(/saved as a new excerpt/)
    // It opens with the sections that list it checked.
    expect(screen.getByRole('checkbox', { name: 'Summary' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Intro paragraph' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Outro' })).not.toBeChecked()
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'I build tools.' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved as a new excerpt')
    expect(sentBody(fetchMock, 'PUT /api/narrative-content/10')).toEqual({
      content: 'I build tools.',
      section_ids: [1, 8],
    })
  })

  it('adds an excerpt under the sections checked, then focuses its Edit button', async () => {
    const added = { ...LOOSE, content_id: 12, content: 'I teach.', sections: [{ id: 9, title: 'Outro' }] }
    const fetchMock = stub({ 'POST /api/narrative-content': [{ status: 201, body: added }] }, [INTRO, LOOSE])
    render(<NarrativeContentPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New excerpt' }))
    const form = screen.getByRole('form', { name: 'New excerpt' })
    const field = within(form).getByLabelText('Narrative content text (required)')
    expect(field).toHaveFocus()
    const picker = within(form).getByRole('group', { name: 'Sections that list it' })
    expect(within(picker).getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked)).toEqual([])
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Outro' }))
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Summary' }))
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'I teach.' } })
    fireEvent.click(within(form).getByText('Add excerpt'))
    expect(await screen.findByRole('status')).toHaveTextContent('Added "I teach.".')
    expect(sentBody(fetchMock, 'POST /api/narrative-content')).toEqual({ content: 'I teach.', section_ids: [1, 9] })
  })

  it('shows a failed add in the form, and returns focus to New excerpt on Cancel', async () => {
    stub({
      'POST /api/narrative-content': [
        { status: 404, body: errorBody('NOT_FOUND', 'That section no longer exists.', 'section_ids') },
      ],
    })
    render(<NarrativeContentPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New excerpt' }))
    fireEvent.change(screen.getByLabelText('Narrative content text (required)'), { target: { value: 'Hi.' } })
    fireEvent.click(screen.getByText('Add excerpt'))
    expect(await screen.findByRole('alert')).toHaveTextContent('That section no longer exists.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Cancel'))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'New excerpt' })).toHaveFocus())
  })

  it('edits which sections list an excerpt', async () => {
    const fetchMock = stub({ 'PUT /api/narrative-content/11': [{ status: 200, body: LOOSE }] })
    render(<NarrativeContentPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit "Thank you for reading."' }))
    const form = screen.getByRole('form', { name: 'Edit "Thank you for reading."' })
    // No sent version uses it, so there's no note.
    expect(within(form).queryByText(/sent version/)).not.toBeInTheDocument()
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Outro' }))
    fireEvent.click(within(form).getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(sentBody(fetchMock, 'PUT /api/narrative-content/11')).toEqual({
      content: 'Thank you for reading.',
      section_ids: [9],
    })
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit "Thank you for reading."' })).toHaveFocus(),
    )
  })

  it('returns focus to Edit when editing is cancelled', async () => {
    stub()
    render(<NarrativeContentPage />)
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${LABEL}` }))
    fireEvent.click(screen.getByText('Cancel'))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: `Edit ${LABEL}` })).toHaveFocus())
  })

  it('lists what a delete affects, then deletes', async () => {
    stub({ 'DELETE /api/narrative-content/10': [{ status: 204 }] })
    render(<NarrativeContentPage />)
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${LABEL}` }))
    const confirm = screen.getByRole('group', { name: `Delete ${LABEL}?` })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    expect(confirm).toHaveTextContent('Used by: Acme letter')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent(`Deleted ${LABEL}.`)
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Narrative content' })).toHaveFocus())
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<NarrativeContentPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the list fails to load', async () => {
    stub({
      'GET /api/narrative-content': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [INTRO] },
      ],
    })
    render(<NarrativeContentPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByRole('heading', { name: INTRO.content })).toBeInTheDocument()
  })

  it('says when there is no narrative content yet', async () => {
    stub({}, [])
    render(<NarrativeContentPage />)
    expect(await screen.findByText('No narrative content yet.')).toBeInTheDocument()
  })
})
