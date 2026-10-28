import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Project } from '../api/projects'
import type { Section } from '../api/sections'
import type { Skill } from '../api/skills'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import ProjectsPage from './ProjectsPage'

const SENT = { kind: 'resume' as const, id: 2, name: 'Acme resume', locked: true }
const TWEAKER: Project = {
  project_id: 4,
  project_title: 'Tweaker',
  done_for: 'Freelance',
  url: 'https://example.com/tweaker',
  dates: 'Spring 2024',
  skills: [{ skill_id: 20, skill_name: 'Python' }],
  bullets: [{ bullet_id: 10, content: 'Built the API' }],
  sections: [{ id: 4, title: 'Projects' }],
  used_by: [SENT],
}
const skill = (id: number, name: string): Skill => ({
  skill_id: id,
  skill_name: name,
  categories: [],
  projects: [],
  used_by: [],
})
const SECTIONS: Section[] = [
  { id: 4, title: 'Projects', built_in: true, skill_categories: [], experience: [], projects: [], bullets: [], used_by: [] },
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
  it('shows each project with its skills, bullets, sections, and uses', async () => {
    stub()
    render(<ProjectsPage />)
    expect(document.title).toBe('Projects – Resume Tweaker')
    const card = (await screen.findByRole('heading', { name: 'Tweaker' })).closest('article') as HTMLElement
    expect(within(card).getByText('Freelance | Spring 2024')).toBeInTheDocument()
    expect(within(card).getByText('https://example.com/tweaker')).toBeInTheDocument()
    expect(within(card).getByText('Skills (1)')).toBeInTheDocument()
    expect(within(card).getByText('Built the API')).toBeInTheDocument()
    expect(within(card).getByText(/Acme resume/)).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("saves a project's skill list", async () => {
    const fetchMock = stub({ 'PUT /api/projects/4/skills': [{ status: 200, body: TWEAKER }] })
    render(<ProjectsPage />)
    const picker = await screen.findByLabelText(`Add to ${LABEL} skills`)
    fireEvent.change(picker, { target: { value: '21' } })
    fireEvent.click(within(picker.parentElement as HTMLElement).getByText('Add'))
    await vi.waitFor(() => expect(sentBody(fetchMock, 'PUT /api/projects/4/skills')).toEqual({ skill_ids: [20, 21] }))
  })

  it('adds a project under "Projects" by default', async () => {
    const fetchMock = stub({ 'POST /api/projects': [{ status: 201, body: TWEAKER }] })
    render(<ProjectsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }))
    const form = screen.getByRole('form', { name: 'New project' })
    expect(within(form).getByLabelText('Project title (required)')).toHaveFocus()
    fireEvent.change(within(form).getByLabelText('Project title (required)'), { target: { value: 'Tweaker' } })
    fireEvent.click(within(form).getByText('Add project'))
    expect(await screen.findByRole('status')).toHaveTextContent(`Added "${LABEL}".`)
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
    fireEvent.click(await screen.findByRole('button', { name: `Edit "${LABEL}"` }))
    const title = screen.getByLabelText('Project title (required)')
    expect(title).toHaveAccessibleDescription(/saved as a new version/)
    await expectNoA11yViolations()
    fireEvent.change(title, { target: { value: 'Resume Tweaker' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent(`Everything that used "${LABEL}" still does`)
  })

  it('adds a new version of a project', async () => {
    const version = { ...TWEAKER, project_id: 8, dates: 'Fall 2024', used_by: [] }
    const fetchMock = stub({ 'POST /api/projects/4/versions': [{ status: 201, body: version }] })
    render(<ProjectsPage />)
    fireEvent.click(await screen.findByRole('button', { name: `New version of "${LABEL}"` }))
    const form = screen.getByRole('form', { name: `New version of "${LABEL}"` })
    expect(within(form).getByLabelText(/Affiliation/)).toHaveValue('Freelance')
    fireEvent.change(within(form).getByLabelText(/Dates/), { target: { value: 'Fall 2024' } })
    fireEvent.click(within(form).getByText('Add version'))
    expect(await screen.findByRole('status')).toHaveTextContent(`keep "${LABEL}" until you pick the new one`)
    expect(sentBody(fetchMock, 'POST /api/projects/4/versions')).toMatchObject({ dates: 'Fall 2024' })
  })

  it('lists what a delete affects', async () => {
    stub()
    render(<ProjectsPage />)
    fireEvent.click(await screen.findByRole('button', { name: `Delete "${LABEL}"` }))
    const confirm = screen.getByRole('group', { name: `Delete "${LABEL}"?` })
    expect(confirm).toHaveTextContent('The skills and bullets stay in the library.')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Cancel'))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: `Delete "${LABEL}"` })).toHaveFocus())
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
