import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Education } from '../shared/api/education'
import type { Section } from '../shared/api/sections'
import { expectNoA11yViolations } from '../test/axe'
import { findCard, loadedDialog, openItem } from '../test/openCard'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import EducationPage from './EducationPage'

const SENT = { kind: 'resume' as const, id: 2, name: 'Acme resume', locked: true }
const DEGREE: Education = {
  education_id: 7,
  created_at: '2026-10-01T09:00:00',
  degree: 'B.A. in English',
  institution: 'State University',
  details: 'Minor in Computer Science',
  graduation: 'May 2015',
  sections: [{ id: 5, title: 'Education' }],
  used_by: [SENT],
}
const LOOSE: Education = {
  ...DEGREE,
  education_id: 8,
  degree: 'Web Development Certificate',
  details: null,
  graduation: null,
  sections: [],
  used_by: [],
}
const LABEL = 'B.A. in English, State University (May 2015)'
const SECTIONS: Section[] = [
  { id: 5, title: 'Education', built_in: true, narrative_content: [], skill_categories: [], experience: [], projects: [], bullets: [], education: [], used_by: [] },
  { id: 9, title: 'Training', built_in: false, narrative_content: [], skill_categories: [], experience: [], projects: [], bullets: [], education: [], used_by: [] },
]

function stub(extra: Record<string, Reply[]> = {}, entries = [DEGREE, LOOSE]) {
  return stubApi({
    'GET /api/education': [
      { status: 200, body: entries },
      { status: 200, body: entries },
    ],
    'GET /api/sections': [
      { status: 200, body: SECTIONS },
      { status: 200, body: SECTIONS },
    ],
    ...extra,
  })
}

describe('EducationPage', () => {
  it('shows each entry, unlisted ones first', async () => {
    stub()
    render(<EducationPage />)
    expect(document.title).toBe('Education – Resume Tweaker')
    const card = await findCard('B.A. in English, State University')
    expect(within(card).getByText('May 2015')).toBeInTheDocument()
    const dialog = await openItem('B.A. in English, State University')
    expect(within(dialog).getByLabelText('Details')).toHaveValue('Minor in Computer Science')
    expect(within(dialog).getByText('Sections that list it (1)')).toBeInTheDocument()
    const unlisted = screen.getByRole('heading', { name: 'Not listed under any section' })
    expect(unlisted.parentElement).toHaveTextContent('Web Development Certificate')
    await expectNoA11yViolations()
  })

  it('adds an entry under the section picked, Education by default', async () => {
    const added = { ...LOOSE, education_id: 9, degree: 'M.A. in English', sections: [{ id: 9, title: 'Training' }] }
    const fetchMock = stub({ 'POST /api/education': [{ status: 201, body: added }] })
    render(<EducationPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New entry' }))
    const form = screen.getByRole('form', { name: 'New education entry' })
    const degree = within(form).getByLabelText(/^Degree and field of study/)
    expect(degree).toHaveFocus()
    expect(within(form).getByLabelText('List it under')).toHaveValue('5')
    expect(within(form).getByLabelText('Details').tagName).toBe('TEXTAREA')
    await expectNoA11yViolations()
    fireEvent.change(degree, { target: { value: 'M.A. in English' } })
    fireEvent.change(within(form).getByLabelText('School or institution (required)'), {
      target: { value: 'State University' },
    })
    fireEvent.change(within(form).getByLabelText('List it under'), { target: { value: '9' } })
    fireEvent.click(within(form).getByText('Add entry'))
    expect(await screen.findByRole('status')).toHaveTextContent('Added "M.A. in English, State University".')
    expect(sentBody(fetchMock, 'POST /api/education')).toMatchObject({ degree: 'M.A. in English', section_id: 9 })
  })

  it('warns that editing an entry a sent version uses saves a new entry', async () => {
    const saved = { ...DEGREE, education_id: 10, graduation: '2015', used_by: [] }
    const fetchMock = stub({ 'PUT /api/education/7': [{ status: 200, body: saved }] })
    render(<EducationPage />)
    await openItem('B.A. in English, State University')
    const form = screen.getByRole('form', { name: `Edit "${LABEL}"` })
    const degree = within(form).getByLabelText(/^Degree and field of study/)
    expect(degree).toHaveAccessibleDescription(/A sent version uses this entry, so saving adds a new one/)
    await expectNoA11yViolations()
    fireEvent.change(within(form).getByLabelText(/^Graduation and honors/), { target: { value: '2015' } })
    fireEvent.click(within(form).getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved as a new entry, "B.A. in English, State University (2015)"',
    )
    expect(sentBody(fetchMock, 'PUT /api/education/7')).toMatchObject({ graduation: '2015' })
  })

  it('closes the dialog and returns focus to Edit when the form is cancelled', async () => {
    stub()
    render(<EducationPage />)
    const edit = await screen.findByRole('button', { name: `View and Edit "${LABEL}"` })
    edit.focus()
    fireEvent.click(edit)
    fireEvent.click(within(await loadedDialog()).getByText('Cancel'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(edit).toHaveFocus()
  })

  it('adds a new version of an entry', async () => {
    const version = { ...DEGREE, education_id: 11, graduation: '2015', used_by: [] }
    const fetchMock = stub({ 'POST /api/education/7/versions': [{ status: 201, body: version }] })
    render(<EducationPage />)
    fireEvent.click(within(await openItem('B.A. in English, State University')).getByRole('button', { name: 'New version' }))
    const form = screen.getByRole('form', { name: `New version of "${LABEL}"` })
    fireEvent.change(within(form).getByLabelText(/^Graduation and honors/), { target: { value: '2015' } })
    await expectNoA11yViolations()
    fireEvent.click(within(form).getByText('Add version'))
    expect(await screen.findByRole('status')).toHaveTextContent(`keep "${LABEL}" until you pick the new one`)
    expect(sentBody(fetchMock, 'POST /api/education/7/versions')).toMatchObject({ graduation: '2015' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists what a delete affects, then deletes', async () => {
    stub({ 'DELETE /api/education/7': [{ status: 204 }] })
    render(<EducationPage />)
    fireEvent.click(within(await openItem('B.A. in English, State University')).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('group', { name: `Delete "${LABEL}"?` })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    expect(confirm).toHaveTextContent('A sent version uses it')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent(`Deleted "${LABEL}".`)
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Education' })).toHaveFocus())
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<EducationPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the list fails to load', async () => {
    stub({
      'GET /api/education': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [DEGREE] },
      ],
    })
    render(<EducationPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByRole('heading', { name: 'B.A. in English, State University' })).toBeInTheDocument()
  })

  it('says when there is no education yet', async () => {
    stub({}, [])
    render(<EducationPage />)
    expect(await screen.findByText('No education yet.')).toBeInTheDocument()
  })
})
