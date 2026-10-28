import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Section } from '../api/sections'
import type { SkillCategory } from '../api/skills'
import { errorBody, sentBody, stubApi, stubPendingApi } from '../test/stubApi'
import { expectNoA11yViolations } from '../test/axe'
import SectionsPage from './SectionsPage'

const SKILLS: Section = {
  id: 2,
  title: 'Skills',
  built_in: true,
  skill_categories: [{ category_id: 3, category_name: 'Back End' }],
  used_by: [],
}
const FREELANCE: Section = {
  id: 6,
  title: 'Freelance',
  built_in: false,
  skill_categories: [],
  used_by: [{ kind: 'resume', id: 2, name: 'Acme resume', locked: true }],
}
const category = (id: number, name: string, builtIn = false): SkillCategory => ({
  category_id: id,
  category_name: name,
  built_in: builtIn,
  skills: [],
  sections: [],
  used_by: [],
})
const CATEGORIES = [category(1, 'Other', true), category(2, 'Front End'), category(3, 'Back End')]

function stub(extra: Record<string, { status: number; body?: unknown }[]> = {}, sections = [SKILLS, FREELANCE]) {
  return stubApi({
    'GET /api/sections': [{ status: 200, body: sections }, { status: 200, body: sections }],
    'GET /api/skill-categories': [
      { status: 200, body: CATEGORIES },
      { status: 200, body: CATEGORIES },
    ],
    ...extra,
  })
}

const card = async (title: string) => (await screen.findByText(title)).closest('article') as HTMLElement

const group = (heading: string) => screen.getByRole('heading', { name: heading }).parentElement as HTMLElement

describe('SectionsPage', () => {
  it('groups sections by whether their titles print', async () => {
    const intro: Section = {
      id: 7,
      title: 'intro',
      built_in: false,
      skill_categories: [],
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

  it("doesn't offer renaming or deleting built-in sections", async () => {
    stub()
    render(<SectionsPage />)
    const skills = await card('Skills')
    expect(within(skills).getByText('built in')).toBeInTheDocument()
    expect(within(skills).queryByText('Rename')).not.toBeInTheDocument()
    expect(within(await card('Freelance')).getByText('Rename')).toBeInTheDocument()
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
    fireEvent.click(within(await card('Skills')).getByText('Add'))
    await screen.findAllByText('Back End')
    expect(sentBody(fetchMock, 'PUT /api/sections/2/skill-categories')).toEqual({ category_ids: [3, 2] })
  })

  it('starts each part of a card open only when it holds something', async () => {
    stub()
    render(<SectionsPage />)
    const freelance = await card('Freelance')
    const part = (title: string) => within(freelance).getByText(title).closest('details') as HTMLDetailsElement
    expect(part('Skill categories it lists (0)').open).toBe(false)
    expect(part('Used by (1)').open).toBe(true)
  })

  it('warns that renaming a section a sent version uses saves a new one', async () => {
    const saved = { ...FREELANCE, id: 12, title: 'Consulting', used_by: [] }
    stub({ 'PUT /api/sections/6': [{ status: 200, body: saved }] })
    render(<SectionsPage />)
    fireEvent.click(within(await card('Freelance')).getByText('Rename'))
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
    stub({ 'DELETE /api/sections/6': [{ status: 204 }] })
    render(<SectionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete "Freelance"' }))
    const confirm = screen.getByRole('group', { name: 'Delete "Freelance"?' })
    expect(confirm).toHaveTextContent('Acme resume')
    expect(confirm).toHaveTextContent('changes the record of what you sent')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted "Freelance".')
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Sections' })).toHaveFocus())
  })

  it('moves focus into a form when it opens and back to its button when it closes', async () => {
    stub()
    render(<SectionsPage />)
    expect(document.title).toBe('Sections – Resume Tweaker')
    fireEvent.click(await screen.findByRole('button', { name: 'Rename "Freelance"' }))
    expect(screen.getByLabelText('Section title')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Rename "Freelance"' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Delete "Freelance"' }))
    expect(within(screen.getByRole('group', { name: 'Delete "Freelance"?' })).getByText('Cancel')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Delete "Freelance"' })).toHaveFocus()
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
})
