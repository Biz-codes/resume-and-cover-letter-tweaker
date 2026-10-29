import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Bullet } from '../api/bullets'
import type { Experience } from '../api/experience'
import type { Section } from '../api/sections'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import ExperiencePage from './ExperiencePage'

const SENT = { kind: 'resume' as const, id: 2, name: 'Acme resume', locked: true }
const SHIPPED = { bullet_id: 10, content: 'Shipped the checkout flow' }
const TESTED = { bullet_id: 11, content: 'Tested it' }
const ENGINEER: Experience = {
  experience_id: 4,
  role_title: 'Engineer',
  organization: 'Acme',
  location: 'Remote',
  dates: '2020 – 2022',
  bullets: [SHIPPED],
  sections: [{ id: 3, title: 'Experience' }],
  used_by: [SENT],
}
const GIG: Experience = {
  ...ENGINEER,
  experience_id: 5,
  role_title: 'Consultant',
  organization: 'Self',
  dates: null,
  bullets: [],
  sections: [],
  used_by: [],
}
const bullet = (ref: { bullet_id: number; content: string }): Bullet => ({
  ...ref,
  experience: [],
  projects: [],
  sections: [],
  used_by: [],
})
const SECTIONS: Section[] = [
  { id: 3, title: 'Experience', built_in: true, narrative_content: [], skill_categories: [], experience: [], projects: [], bullets: [], education: [], used_by: [] },
  { id: 6, title: 'Freelance', built_in: false, narrative_content: [], skill_categories: [], experience: [], projects: [], bullets: [], education: [], used_by: [] },
]

function stub(extra: Record<string, Reply[]> = {}, roles = [ENGINEER, GIG]) {
  const twice = (body: unknown) => [
    { status: 200, body },
    { status: 200, body },
  ]
  return stubApi({
    'GET /api/experience': twice(roles),
    'GET /api/bullet-points': twice([bullet(SHIPPED), bullet(TESTED)]),
    'GET /api/sections': twice(SECTIONS),
    ...extra,
  })
}

const roleCard = async (name: string) =>
  (await screen.findByRole('heading', { name })).closest('article') as HTMLElement

describe('ExperiencePage', () => {
  it('shows each role with its bullets, sections, and uses, and unlisted roles first', async () => {
    stub()
    render(<ExperiencePage />)
    expect(document.title).toBe('Experience – Resume Tweaker')
    const engineer = await roleCard('Engineer, Acme')
    expect(within(engineer).getByText('Remote | 2020 – 2022')).toBeInTheDocument()
    expect(within(engineer).getByText('Bullets (1)')).toBeInTheDocument()
    expect(within(engineer).getByText('Shipped the checkout flow')).toBeInTheDocument()
    expect(within(engineer).getByText('Sections that list it (1)')).toBeInTheDocument()
    expect(within(engineer).getByText(/Acme resume/)).toBeInTheDocument()
    const unlisted = screen.getByRole('heading', { name: 'Not listed under any section' })
    expect(unlisted.parentElement).toContainElement(await roleCard('Consultant, Self'))
    await expectNoA11yViolations()
  })

  it('adds a role under the chosen section', async () => {
    const fetchMock = stub({ 'POST /api/experience': [{ status: 201, body: GIG }] })
    render(<ExperiencePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New role' }))
    const form = screen.getByRole('form', { name: 'New role' })
    expect(within(form).getByLabelText('Title (required)')).toHaveFocus()
    fireEvent.change(within(form).getByLabelText('List it under'), { target: { value: '6' } })
    fireEvent.change(within(form).getByLabelText('Title (required)'), { target: { value: 'Consultant' } })
    fireEvent.change(within(form).getByLabelText('Organization (required)'), { target: { value: 'Self' } })
    await expectNoA11yViolations()
    fireEvent.click(within(form).getByText('Add role'))
    expect(await screen.findByRole('status')).toHaveTextContent('Added "Consultant, Self".')
    expect(sentBody(fetchMock, 'POST /api/experience')).toEqual({
      role_title: 'Consultant',
      organization: 'Self',
      location: null,
      dates: null,
      section_id: 6,
    })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit "Consultant, Self"' })).toHaveFocus())
  })

  it('keeps the input and highlights the field when saving fails', async () => {
    stub({
      'POST /api/experience': [
        { status: 422, body: errorBody('VALIDATION_FAILED', 'Organization is required.', 'organization') },
      ],
    })
    render(<ExperiencePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Title (required)'), { target: { value: 'Consultant' } })
    fireEvent.click(screen.getByText('Add role'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Organization is required.')
    expect(screen.getByLabelText('Organization (required)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Title (required)')).toHaveValue('Consultant')
  })

  it('warns that editing a role a sent version uses saves a new version', async () => {
    const saved = { ...ENGINEER, experience_id: 7, role_title: 'Lead Engineer', used_by: [] }
    const fetchMock = stub({ 'PUT /api/experience/4': [{ status: 200, body: saved }] }, [ENGINEER])
    render(<ExperiencePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit "Engineer, Acme (2020 – 2022)"' }))
    const title = screen.getByLabelText('Title (required)')
    expect(title).toHaveFocus()
    expect(title).toHaveAccessibleDescription(/saved as a new version/)
    await expectNoA11yViolations()
    fireEvent.change(title, { target: { value: 'Lead Engineer' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved as a new version, "Lead Engineer, Acme (2020 – 2022)". Everything that used "Engineer, Acme (2020 – 2022)" still does',
    )
    expect(sentBody(fetchMock, 'PUT /api/experience/4')).toMatchObject({
      role_title: 'Lead Engineer',
      apply_to_unsent: false,
    })
  })

  it('asks whether to apply a change to resumes in progress', async () => {
    const draft = { kind: 'resume' as const, id: 3, name: 'Draft resume', locked: false }
    const inUse = { ...ENGINEER, used_by: [SENT, draft] }
    const saved = { ...inUse, experience_id: 7, dates: '2020 – 2023', used_by: [draft] }
    const fetchMock = stub({ 'PUT /api/experience/4': [{ status: 200, body: saved }] }, [inUse])
    render(<ExperiencePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit "Engineer, Acme (2020 – 2022)"' }))
    const choice = screen.getByRole('group', { name: /Used by: Draft resume\.$/ })
    expect(within(choice).getByRole('radio', { name: /No, save it as a new version/ })).toBeChecked()
    await expectNoA11yViolations()
    fireEvent.click(within(choice).getByRole('radio', { name: 'Yes, change it for them too.' }))
    fireEvent.change(screen.getByLabelText(/Dates/), { target: { value: '2020 – 2023' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Resumes and cover letters in progress use it now')
    expect(sentBody(fetchMock, 'PUT /api/experience/4')).toMatchObject({ dates: '2020 – 2023', apply_to_unsent: true })
  })

  it("doesn't ask when nothing in progress uses the role", async () => {
    stub({}, [{ ...ENGINEER, used_by: [] }])
    render(<ExperiencePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit "Engineer, Acme (2020 – 2022)"' }))
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Title (required)')).not.toHaveAccessibleDescription()
  })

  it('adds a new version of a role, and returns focus on cancel', async () => {
    const version = { ...ENGINEER, experience_id: 8, role_title: 'Senior Engineer', used_by: [] }
    const fetchMock = stub({ 'POST /api/experience/4/versions': [{ status: 201, body: version }] }, [ENGINEER])
    render(<ExperiencePage />)
    const button = await screen.findByRole('button', { name: 'New version of "Engineer, Acme (2020 – 2022)"' })
    fireEvent.click(button)
    fireEvent.click(screen.getByText('Cancel'))
    await vi.waitFor(() => expect(button).toHaveFocus())
    fireEvent.click(button)
    const form = screen.getByRole('form', { name: 'New version of "Engineer, Acme (2020 – 2022)"' })
    expect(within(form).getByLabelText('Title (required)')).toHaveValue('Engineer')
    await expectNoA11yViolations()
    fireEvent.change(within(form).getByLabelText('Title (required)'), { target: { value: 'Senior Engineer' } })
    fireEvent.click(within(form).getByText('Add version'))
    expect(await screen.findByRole('status')).toHaveTextContent('keep "Engineer, Acme (2020 – 2022)" until you pick the new one')
    expect(sentBody(fetchMock, 'POST /api/experience/4/versions')).toMatchObject({ role_title: 'Senior Engineer' })
  })

  it("saves a role's bullet list and writes new bullets under it", async () => {
    const fetchMock = stub({
      'PUT /api/experience/4/bullets': [{ status: 200, body: ENGINEER }],
      'POST /api/bullet-points': [{ status: 201, body: bullet(TESTED) }],
    })
    render(<ExperiencePage />)
    const engineer = await roleCard('Engineer, Acme')
    fireEvent.change(within(engineer).getByLabelText('Add to Engineer, Acme (2020 – 2022) bullets'), {
      target: { value: '11' },
    })
    fireEvent.click(within(engineer).getByText('Add'))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'PUT /api/experience/4/bullets')).toEqual({ bullet_ids: [10, 11] }),
    )
    fireEvent.change(within(engineer).getByLabelText('New bullet for Engineer, Acme (2020 – 2022)'), {
      target: { value: 'Led the team' },
    })
    fireEvent.click(within(engineer).getByText('Add bullet'))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'POST /api/bullet-points')).toEqual({ content: 'Led the team', experience_id: 4 }),
    )
  })

  it('lists what a delete affects, then deletes', async () => {
    stub({ 'DELETE /api/experience/4': [{ status: 204 }] })
    render(<ExperiencePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete "Engineer, Acme (2020 – 2022)"' }))
    const confirm = screen.getByRole('group', { name: 'Delete "Engineer, Acme (2020 – 2022)"?' })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    expect(confirm).toHaveTextContent('Used by: Acme resume.')
    expect(confirm).toHaveTextContent('The bullets stay in the library.')
    expect(confirm).toHaveTextContent('changes the record of what you sent')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted "Engineer, Acme (2020 – 2022)".')
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Experience' })).toHaveFocus())
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<ExperiencePage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the lists fail to load', async () => {
    stub({
      'GET /api/experience': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [ENGINEER] },
      ],
    })
    render(<ExperiencePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Retry'))
    expect(await roleCard('Engineer, Acme')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says when there are no roles yet', async () => {
    stub({}, [])
    render(<ExperiencePage />)
    expect(await screen.findByText('No roles yet.')).toBeInTheDocument()
    expect(screen.queryByText('Not listed under any section')).not.toBeInTheDocument()
  })
})
