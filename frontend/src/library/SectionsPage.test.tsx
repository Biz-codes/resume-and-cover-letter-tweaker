import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Education } from '../shared/api/education'
import type { Experience } from '../shared/api/experience'
import type { Section } from '../shared/api/sections'
import type { SkillCategory } from '../shared/api/skills'
import { findCard, loadedDialog, openItem } from '../test/openCard'
import { errorBody, sentBody, stubApi, stubPendingApi } from '../test/stubApi'
import { expectNoA11yViolations } from '../test/axe'
import SectionsPage from './SectionsPage'
import { unsent } from '../test/unsent'

const SKILLS: Section = {
  hidden: false,
  id: 2,
  title: 'Skills',
  built_in: true,
  narrative_content: [],
  education: [],
  skill_categories: [{ category_id: 3, category_name: 'Back End' }],
  experience: [],
  projects: [],
  bullets: [],
  used_by: [],
}
const FREELANCE: Section = {
  hidden: false,
  id: 6,
  title: 'Freelance',
  built_in: false,
  narrative_content: [],
  education: [],
  skill_categories: [],
  experience: [],
  projects: [],
  bullets: [],
  used_by: [{ kind: 'resume', id: 2, name: 'Acme resume', locked: true }],
}
const category = (id: number, name: string, builtIn = false): SkillCategory => ({
  hidden: false,
  category_id: id,
  category_name: name,
  built_in: builtIn,
  skills: [],
  sections: [],
  used_by: [],
})
const ROLE: Experience = {
  hidden: false,
  experience_id: 9,
  created_at: '2026-10-01T09:00:00',
  role_title: 'Engineer',
  organization: 'Acme',
  location: null,
  dates: null,
  bullets: [],
  sections: [],
  used_by: [],
}
const DEGREE: Education = {
  hidden: false,
  education_id: 7,
  created_at: '2026-10-01T09:00:00',
  degree: 'B.A. in English',
  institution: 'State University',
  details: null,
  graduation: 'May 2015',
  sections: [],
  used_by: [],
}
const CATEGORIES = [category(1, 'Other', true), category(2, 'Front End'), category(3, 'Back End')]

function stub(extra: Record<string, { status: number; body?: unknown }[]> = {}, sections = [SKILLS, FREELANCE]) {
  return stubApi({
    'GET /api/sections': [{ status: 200, body: sections }, { status: 200, body: sections }],
    'GET /api/skill-categories': [
      { status: 200, body: CATEGORIES },
      { status: 200, body: CATEGORIES },
    ],
    'GET /api/experience': [
      { status: 200, body: [ROLE] },
      { status: 200, body: [ROLE] },
    ],
    'GET /api/projects': [
      { status: 200, body: [] },
      { status: 200, body: [] },
    ],
    'GET /api/bullet-points': [
      { status: 200, body: [] },
      { status: 200, body: [] },
    ],
    'GET /api/narrative-content': [
      { status: 200, body: [] },
      { status: 200, body: [] },
    ],
    'GET /api/education': [
      { status: 200, body: [DEGREE] },
      { status: 200, body: [DEGREE] },
    ],
    ...extra,
  })
}

// A section's dialog. Its card's heading also holds its tags ("built in"), so match its start.
const card = (title: string) => openItem(new RegExp(`^${title}`))

const group = (heading: string) => screen.getByRole('heading', { name: heading }).parentElement as HTMLElement

describe('SectionsPage', () => {
  it('groups sections by whether their titles print', async () => {
    const intro: Section = {
      hidden: false,
      id: 7,
      title: 'intro',
      built_in: false,
      narrative_content: [],
      education: [],
      skill_categories: [],
      experience: [],
      projects: [],
      bullets: [],
      used_by: [{ kind: 'cover_letter', id: 1, name: 'Acme letter', locked: false }],
    }
    const draft: Section = { ...intro, id: 8, title: 'Volunteering', used_by: [] }
    stub({}, [SKILLS, FREELANCE, intro, draft])
    render(<SectionsPage />)
    await screen.findByText('intro')
    expect(within(group('Resume headings')).getByText('Skills')).toBeInTheDocument()
    expect(within(group('Resume headings')).getByText('Freelance')).toBeInTheDocument()
    expect(within(group('Cover letter labels')).getByText('intro')).toBeInTheDocument()
    expect(within(group('Cover letter labels')).getByText(/Only you see these/)).toBeInTheDocument()
    expect(within(group('Not used yet')).getByText('Volunteering')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("doesn't offer renaming or deleting built-in sections, only a new version", async () => {
    stub({}, [SKILLS, unsent(FREELANCE)])
    render(<SectionsPage />)
    expect(within(await findCard(/^Skills/)).getByText('built in')).toBeInTheDocument()
    const skills = await card('Skills')
    expect(within(skills).queryByLabelText('Section title')).not.toBeInTheDocument()
    expect(within(skills).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(within(skills).getByRole('button', { name: 'New version' })).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(within(skills).getByRole('button', { name: 'Close' }))
    const freelance = await card('Freelance')
    expect(within(freelance).getByLabelText('Section title')).toHaveValue('Freelance')
    expect(within(freelance).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('adds a new version of a section, built-in ones too', async () => {
    const version = { ...SKILLS, id: 13, title: 'Technical Skills', built_in: false }
    const fetchMock = stub({ 'POST /api/sections/2/versions': [{ status: 201, body: version }] })
    render(<SectionsPage />)
    fireEvent.click(within(await card('Skills')).getByRole('button', { name: 'New version' }))
    const field = screen.getByLabelText("New version's title")
    expect(field).toHaveFocus()
    fireEvent.change(field, { target: { value: 'Technical Skills' } })
    fireEvent.click(screen.getByText('Add version'))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added "Technical Skills", with the same lists. Resumes and cover letters keep "Skills" until you pick the new one.',
    )
    expect(sentBody(fetchMock, 'POST /api/sections/2/versions')).toEqual({ title: 'Technical Skills' })
  })

  it('offers categories to list, but never "Other"', async () => {
    const fetchMock = stub({ 'PUT /api/sections/2/skill-categories': [{ status: 200, body: SKILLS }] })
    render(<SectionsPage />)
    const select = within(await card('Skills')).getByLabelText('Add to Skills skill categories')
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Choose one to add…',
      'Front End',
    ])
    fireEvent.change(select, { target: { value: '2' } })
    fireEvent.click(within(select.parentElement as HTMLElement).getByText('Add'))
    await screen.findAllByText('Back End')
    expect(sentBody(fetchMock, 'PUT /api/sections/2/skill-categories')).toEqual({ category_ids: [3, 2] })
  })

  it('starts each part of a dialog open only when it holds something', async () => {
    stub()
    render(<SectionsPage />)
    const freelance = await card('Freelance')
    const part = (title: string) => within(freelance).getByText(title).closest('details') as HTMLDetailsElement
    expect(part('Skill categories (0)').open).toBe(false)
    expect(part('Used by (1)').open).toBe(true)
  })

  it('shows a built-in section’s own kind and what it lists, with the other kinds under More options', async () => {
    const skills = { ...SKILLS, bullets: [{ bullet_id: 4, content: 'Ran workshops' }] }
    stub({}, [skills, FREELANCE])
    render(<SectionsPage />)
    const dialog = await card('Skills')
    const more = within(dialog).getByRole('button', { name: 'More options for Skills' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).getByText('Skill categories (1)')).toBeInTheDocument()
    expect(within(dialog).getByText('Bullets (1)')).toBeInTheDocument()
    expect(within(dialog).queryByText('Roles (0)')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Narrative content (0)')).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getAllByText(/^(Narrative content|Roles|Projects|Education) \(0\)$/)).toHaveLength(4)
  })

  it('opens More options from the start for a section that lists nothing', async () => {
    stub()
    render(<SectionsPage />)
    const dialog = await card('Freelance')
    expect(within(dialog).getByRole('button', { name: 'More options for Freelance' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('warns that renaming a section a sent version uses saves a new one', async () => {
    const saved = { ...FREELANCE, id: 12, title: 'Consulting', used_by: [] }
    stub({ 'PUT /api/sections/6': [{ status: 200, body: saved }] })
    render(<SectionsPage />)
    await card('Freelance')
    expect(screen.getByText(/saved as a new section/)).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.change(screen.getByLabelText('Section title'), { target: { value: 'Consulting' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved as a new section, "Consulting". Sent versions keep "Freelance".',
    )
  })

  it('highlights the title when it duplicates another section', async () => {
    stub({
      'POST /api/sections': [
        { status: 409, body: errorBody('DUPLICATE', 'There\'s already a section named "Skills".', 'title') },
      ],
    })
    render(<SectionsPage />)
    fireEvent.change(await screen.findByLabelText('New section title'), { target: { value: 'skills' } })
    fireEvent.click(screen.getByText('Add section'))
    expect(await screen.findByRole('alert')).toHaveTextContent('already a section named "Skills"')
    expect(screen.getByLabelText('New section title')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('New section title')).toHaveValue('skills')
    await expectNoA11yViolations()
  })

  it('lists what uses a section before deleting it', async () => {
    stub({ 'DELETE /api/sections/6': [{ status: 204 }] }, [SKILLS, unsent(FREELANCE)])
    render(<SectionsPage />)
    fireEvent.click(within(await card('Freelance')).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('group', { name: 'Delete "Freelance"?' })
    expect(confirm).toHaveTextContent('Acme resume')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted "Freelance".')
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Sections' })).toHaveFocus())
  })

  it('moves focus into the dialog and its confirm, and back to their buttons when they close', async () => {
    stub({}, [SKILLS, unsent(FREELANCE)])
    render(<SectionsPage />)
    expect(document.title).toBe('Sections – Resume Tweaker')
    const edit = await screen.findByRole('button', { name: 'View and Edit "Freelance"' })
    edit.focus()
    fireEvent.click(edit)
    const dialog = screen.getByRole('dialog', { name: 'Freelance' })
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveFocus()
    await loadedDialog()
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(within(screen.getByRole('group', { name: 'Delete "Freelance"?' })).getByText('Cancel')).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(edit).toHaveFocus()
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<SectionsPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the list fails to load', async () => {
    stub({
      'GET /api/sections': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [SKILLS] },
      ],
    })
    render(<SectionsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByText('Skills')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("saves a section's role list and writes bullets directly in it", async () => {
    const fetchMock = stub({
      'PUT /api/sections/6/experience': [{ status: 200, body: FREELANCE }],
      'POST /api/bullet-points': [{ status: 201, body: {} }],
    })
    render(<SectionsPage />)
    const freelance = await card('Freelance')
    expect(within(freelance).getByText('Roles (0)')).toBeInTheDocument()
    const picker = within(freelance).getByLabelText('Add to Freelance roles')
    fireEvent.change(picker, { target: { value: '9' } })
    fireEvent.click(within(picker.parentElement as HTMLElement).getByText('Add'))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'PUT /api/sections/6/experience')).toEqual({ experience_ids: [9] }),
    )
    fireEvent.change(within(freelance).getByLabelText('New bullet for Freelance'), { target: { value: 'Ran workshops' } })
    fireEvent.click(within(freelance).getByText('Add bullet'))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'POST /api/bullet-points')).toEqual({ content: 'Ran workshops', section_id: 6 }),
    )
    await vi.waitFor(() => expect(within(freelance).getByRole('status')).toHaveTextContent('Added the bullet "Ran workshops".'))
  })

  it('offers no hidden item to add to a section', async () => {
    stub({ 'GET /api/experience': [{ status: 200, body: [{ ...ROLE, hidden: true }] }] })
    render(<SectionsPage />)
    const freelance = await card('Freelance')
    expect(within(freelance).getByText('Roles (0)')).toBeInTheDocument()
    expect(within(freelance).queryByLabelText('Add to Freelance roles')).not.toBeInTheDocument()
    expect(within(freelance).getByLabelText('Add to Freelance education')).toBeInTheDocument()
  })

  it("writes narrative content in a section and saves its education list", async () => {
    const fetchMock = stub({
      'POST /api/narrative-content': [{ status: 201, body: {} }],
      'PUT /api/sections/6/education': [{ status: 200, body: FREELANCE }],
    })
    render(<SectionsPage />)
    const freelance = await card('Freelance')
    expect(within(freelance).getByText('Narrative content (0)')).toBeInTheDocument()
    fireEvent.change(within(freelance).getByLabelText('New narrative content for Freelance'), {
      target: { value: 'I take on short projects.' },
    })
    fireEvent.click(within(freelance).getByText('Add narrative content'))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'POST /api/narrative-content')).toEqual({ content: 'I take on short projects.', section_ids: [6] }),
    )
    await vi.waitFor(() =>
      expect(within(freelance).getByRole('status')).toHaveTextContent(
        'Added the narrative content "I take on short projects.".',
      ),
    )
    const picker = within(freelance).getByLabelText('Add to Freelance education')
    expect(within(picker).getByRole('option', { name: 'B.A. in English, State University (May 2015)' })).toBeInTheDocument()
    fireEvent.change(picker, { target: { value: '7' } })
    fireEvent.click(within(picker.parentElement as HTMLElement).getByText('Add'))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'PUT /api/sections/6/education')).toEqual({ education_ids: [7] }),
    )
  })
})
