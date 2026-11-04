import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NarrativeContent } from '../shared/api/narrativeContent'
import type { Section } from '../shared/api/sections'
import { expectNoA11yViolations } from '../test/axe'
import { loadedDialog, openItem } from '../test/openCard'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import NarrativeContentPage from './NarrativeContentPage'
import { unsent } from '../test/unsent'
import { expectNotice } from '../test/notice'

const SENT = { kind: 'cover_letter' as const, id: 2, name: 'Acme letter', locked: true }
const INTRO: NarrativeContent = {
  hidden: false,
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
    hidden: false,
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
  it('shows the sections that list each excerpt in its dialog, unlisted excerpts first', async () => {
    stub()
    render(<NarrativeContentPage />)
    expect(document.title).toBe('Narrative content – Resume Tweaker')
    expect(screen.getByText(/anything from one sentence to a full paragraph, grouped however you choose/)).toBeInTheDocument()
    expect(screen.getByText(/Write new excerpts here OR on the Sections page/)).toBeInTheDocument()
    const unlisted = await screen.findByRole('heading', { name: 'Not listed anywhere' })
    expect(unlisted.parentElement).toHaveTextContent('Thank you for reading.')
    const dialog = await openItem(INTRO.content)
    expect(within(dialog).getByRole('checkbox', { name: 'Intro paragraph' })).toBeChecked()
    expect(within(dialog).getByText(/Acme letter/)).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('warns that editing an excerpt a sent version uses saves a new version', async () => {
    const saved = { ...INTRO, content_id: 12, content: 'I build tools.', used_by: [] }
    const fetchMock = stub({ 'PUT /api/narrative-content/10': [{ status: 200, body: saved }] })
    render(<NarrativeContentPage />)
    fireEvent.click(await screen.findByRole('button', { name: `View and Edit ${LABEL}` }))
    await loadedDialog()
    const field = screen.getByLabelText('Narrative content text (required)')
    expect(field).toHaveAccessibleDescription(/A sent version uses this excerpt, so saving adds a new one/)
    // It opens with the sections that list it checked.
    expect(screen.getByRole('checkbox', { name: 'Summary' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Intro paragraph' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Outro' })).not.toBeChecked()
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'I build tools.' } })
    fireEvent.click(screen.getByText('Save'))
    await expectNotice('Saved as a new version')
    expect(sentBody(fetchMock, 'PUT /api/narrative-content/10')).toEqual({
      content: 'I build tools.',
      section_ids: [1, 8],
      apply_to: [],
    })
  })

  it('adds an excerpt under the sections checked, then focuses its View and Edit button', async () => {
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
    await expectNotice('Added "I teach.".')
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
    fireEvent.click(await screen.findByRole('button', { name: 'View and Edit "Thank you for reading."' }))
    await loadedDialog()
    const form = screen.getByRole('form', { name: 'Edit "Thank you for reading."' })
    // No sent version uses it, so there's no note.
    expect(within(form).queryByText(/sent version/)).not.toBeInTheDocument()
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Outro' }))
    fireEvent.click(within(form).getByText('Save'))
    await expectNotice('Saved.')
    expect(sentBody(fetchMock, 'PUT /api/narrative-content/11')).toEqual({
      content: 'Thank you for reading.',
      section_ids: [9],
      apply_to: [],
    })
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'View and Edit "Thank you for reading."' })).toHaveFocus(),
    )
  })

  it('closes the dialog and returns focus to Edit when editing is cancelled', async () => {
    stub()
    render(<NarrativeContentPage />)
    const edit = await screen.findByRole('button', { name: `View and Edit ${LABEL}` })
    edit.focus()
    fireEvent.click(edit)
    fireEvent.click(within(await loadedDialog()).getByText('Cancel'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(edit).toHaveFocus()
  })

  it('adds a new version of an excerpt', async () => {
    const version = { ...INTRO, content_id: 13, content: 'I build web tools.', used_by: [] }
    const fetchMock = stub({ 'POST /api/narrative-content/10/versions': [{ status: 201, body: version }] })
    render(<NarrativeContentPage />)
    fireEvent.click(within(await openItem(INTRO.content)).getByRole('button', { name: /^New version of / }))
    const form = screen.getByRole('form', { name: `New version of ${LABEL}` })
    fireEvent.change(within(form).getByLabelText('Narrative content text (required)'), {
      target: { value: 'I build web tools.' },
    })
    await expectNoA11yViolations()
    fireEvent.click(within(form).getByText('Add version'))
    await expectNotice('Added a new version')
    expect(sentBody(fetchMock, 'POST /api/narrative-content/10/versions')).toEqual({ content: 'I build web tools.' })
  })

  it('lists what a delete affects, then deletes', async () => {
    stub({ 'DELETE /api/narrative-content/10': [{ status: 204 }] }, [unsent(INTRO), LOOSE])
    render(<NarrativeContentPage />)
    fireEvent.click(within(await openItem(INTRO.content)).getByRole('button', { name: /^Delete "/ }))
    const confirm = screen.getByRole('group', { name: `Delete ${LABEL}?` })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    expect(confirm).toHaveTextContent('Used by: Acme letter')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    await expectNotice(`Deleted ${LABEL}.`)
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
