import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Project } from '../shared/api/projects'
import type { Section } from '../shared/api/sections'
import type { Skill } from '../shared/api/skills'
import { expectNoA11yViolations } from '../test/axe'
import { findCard, openItem } from '../test/openCard'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import ProjectsPage from './ProjectsPage'
import { unsent } from '../test/unsent'
import { expectNotice } from '../test/notice'

const SENT = { kind: 'resume' as const, id: 2, name: 'Acme resume', locked: true }
const TWEAKER: Project = {
  hidden: false,
  project_id: 4,
  created_at: '2026-10-01T09:00:00',
  project_title: 'Tweaker',
  done_for: 'Freelance',
  url: 'https://example.com/tweaker',
  dates: 'Spring 2024',
  skills: [{ hidden: false, skill_id: 20, skill_name: 'Python' }],
  bullets: [{ bullet_id: 10, content: 'Built the API' }],
  sections: [{ id: 4, title: 'Projects' }],
  used_by: [SENT],
}
const skill = (id: number, name: string): Skill => ({
  hidden: false,
  skill_id: id,
  skill_name: name,
  categories: [],
  projects: [],
  used_by: [],
})
const SECTIONS: Section[] = [
  { hidden: false, id: 4, title: 'Projects', built_in: true, narrative_content: [], skill_categories: [], experience: [], projects: [], bullets: [], education: [], used_by: [] },
]

function stub(extra: Record<string, Reply[]> = {}, projects = [TWEAKER]) {
  const twice = (body: unknown) => [
    { status: 200, body },
    { status: 200, body },
  ]
  return stubApi({
    'GET /api/projects': twice(projects),
    'GET /api/skills': twice([skill(20, 'Python'), skill(21, 'React')]),
    'GET /api/bullet-points': twice([]),
    'GET /api/sections': twice(SECTIONS),
    ...extra,
  })
}

const LABEL = 'Tweaker (Freelance)'

describe('ProjectsPage', () => {
  it('shows each project as a card, and its skills, bullets, sections, and uses in its dialog', async () => {
    stub()
    render(<ProjectsPage />)
    expect(document.title).toBe('Projects – Resume Tweaker')
    const card = await findCard('Tweaker')
    expect(within(card).getByText('Freelance | Spring 2024')).toBeInTheDocument()
    expect(within(card).getByText('https://example.com/tweaker')).toBeInTheDocument()
    const dialog = await openItem('Tweaker')
    expect(dialog).toHaveAccessibleName(LABEL)
    expect(within(dialog).getByText('Skills (1)')).toBeInTheDocument()
    expect(within(dialog).getByText('Built the API')).toBeInTheDocument()
    expect(within(dialog).getByText(/Acme resume/)).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("saves a project's skill list", async () => {
    const fetchMock = stub({ 'PUT /api/projects/4/skills': [{ status: 200, body: TWEAKER }] })
    render(<ProjectsPage />)
    await openItem('Tweaker')
    const picker = await screen.findByLabelText(`Choose one to add to ${LABEL} skills`)
    fireEvent.change(picker, { target: { value: '21' } })
    // Each list's Add names its list, since the dialog has more than one.
    fireEvent.click(screen.getByRole('button', { name: `Add to ${LABEL} skills` }))
    await vi.waitFor(() => expect(sentBody(fetchMock, 'PUT /api/projects/4/skills')).toEqual({ skill_ids: [20, 21] }))
  })

  it('writes a new bullet under a project and says so in its dialog', async () => {
    const fetchMock = stub({ 'POST /api/bullet-points': [{ status: 201, body: {} }] })
    render(<ProjectsPage />)
    const dialog = await openItem('Tweaker')
    fireEvent.change(within(dialog).getByLabelText(`New bullet for ${LABEL}`), { target: { value: 'Wrote the docs' } })
    fireEvent.click(within(dialog).getByText('Add bullet'))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'POST /api/bullet-points')).toEqual({ content: 'Wrote the docs', project_id: 4 }),
    )
    await vi.waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('Added the bullet "Wrote the docs".'))
  })

  it('adds a project under "Projects" by default', async () => {
    const fetchMock = stub({ 'POST /api/projects': [{ status: 201, body: TWEAKER }] })
    render(<ProjectsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }))
    const form = screen.getByRole('form', { name: 'New project' })
    expect(within(form).getByLabelText('Project title (required)')).toHaveFocus()
    fireEvent.change(within(form).getByLabelText('Project title (required)'), { target: { value: 'Tweaker' } })
    fireEvent.click(within(form).getByText('Add project'))
    await expectNotice(`Added "${LABEL}".`)
    expect(sentBody(fetchMock, 'POST /api/projects')).toEqual({
      project_title: 'Tweaker',
      done_for: null,
      url: null,
      dates: null,
      section_id: 4,
    })
  })

  it('warns that editing a project a sent version uses saves a new version', async () => {
    const saved = { ...TWEAKER, project_id: 7, project_title: 'Resume Tweaker', used_by: [] }
    stub({ 'PUT /api/projects/4': [{ status: 200, body: saved }] })
    render(<ProjectsPage />)
    await openItem('Tweaker')
    const title = screen.getByLabelText('Project title (required)')
    expect(title).toHaveAccessibleDescription(/so saving adds a new version/)
    await expectNoA11yViolations()
    fireEvent.change(title, { target: { value: 'Resume Tweaker' } })
    fireEvent.click(screen.getByText('Save'))
    await expectNotice(`Everything that used "${LABEL}" still does`)
  })

  it('asks which resumes in progress get a change, as roles do', async () => {
    const draft = { kind: 'resume' as const, id: 3, name: 'Draft resume', locked: false }
    const inUse = { ...TWEAKER, used_by: [draft] }
    const fetchMock = stub({ 'PUT /api/projects/4': [{ status: 200, body: { ...inUse, dates: '2024' } }] }, [inUse])
    render(<ProjectsPage />)
    await openItem('Tweaker')
    // Nothing sent uses it, so there's no note on the first field.
    expect(screen.getByLabelText('Project title (required)')).not.toHaveAccessibleDescription()
    const choice = screen.getByRole('group', { name: 'Apply this change to which resumes and cover letters in progress?' })
    const box = within(choice).getByRole('checkbox', { name: 'Resume: Draft resume' })
    expect(box).not.toBeChecked()
    await expectNoA11yViolations()
    fireEvent.click(box)
    fireEvent.change(screen.getByLabelText(/Dates/), { target: { value: '2024' } })
    fireEvent.click(screen.getByText('Save'))
    await expectNotice('Saved.')
    expect(sentBody(fetchMock, 'PUT /api/projects/4')).toMatchObject({
      dates: '2024',
      apply_to: [{ kind: 'resume', id: 3 }],
    })
  })

  it('adds a new version of a project', async () => {
    const version = { ...TWEAKER, project_id: 8, dates: 'Fall 2024', used_by: [] }
    const fetchMock = stub({ 'POST /api/projects/4/versions': [{ status: 201, body: version }] })
    render(<ProjectsPage />)
    fireEvent.click(within(await openItem('Tweaker')).getByRole('button', { name: /^New version of / }))
    const form = screen.getByRole('form', { name: `New version of "${LABEL}"` })
    expect(within(form).getByLabelText(/Affiliation/)).toHaveValue('Freelance')
    fireEvent.change(within(form).getByLabelText(/Dates/), { target: { value: 'Fall 2024' } })
    fireEvent.click(within(form).getByText('Add version'))
    await expectNotice(`keep "${LABEL}" until you pick the new one`)
    expect(sentBody(fetchMock, 'POST /api/projects/4/versions')).toMatchObject({ dates: 'Fall 2024' })
  })

  it('lists what a delete affects', async () => {
    stub({}, [unsent(TWEAKER)])
    render(<ProjectsPage />)
    const dialog = await openItem('Tweaker')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete "/ }))
    const confirm = screen.getByRole('group', { name: `Delete "${LABEL}"?` })
    expect(confirm).toHaveTextContent('The skills and bullets stay in the library.')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Cancel'))
    await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: /^Delete "/ })).toHaveFocus())
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<ProjectsPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the lists fail to load', async () => {
    stub({
      'GET /api/projects': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [TWEAKER] },
      ],
    })
    render(<ProjectsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByRole('heading', { name: 'Tweaker' })).toBeInTheDocument()
  })

  it('shows unlisted projects first, and says when there are none listed', async () => {
    stub({}, [{ ...TWEAKER, sections: [] }])
    render(<ProjectsPage />)
    const unlisted = await screen.findByRole('heading', { name: 'Not listed under any section' })
    expect(unlisted.parentElement).toHaveTextContent('Tweaker')
    expect(screen.getByText('No projects yet.')).toBeInTheDocument()
  })
})
