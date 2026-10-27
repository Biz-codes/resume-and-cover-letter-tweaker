import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Section } from '../api/sections'
import type { Skill, SkillCategory } from '../api/skills'
import { sentBody, stubApi, type Reply } from '../test/stubApi'
import SkillsPage from './SkillsPage'

const SENT = { kind: 'resume' as const, id: 2, name: 'Acme resume', locked: true }
const OTHER: SkillCategory = {
  category_id: 1,
  category_name: 'Other',
  built_in: true,
  skills: [],
  sections: [],
  used_by: [],
}
const AI: SkillCategory = {
  category_id: 6,
  category_name: 'AI',
  built_in: false,
  skills: [
    { skill_id: 10, skill_name: 'Claude' },
    { skill_id: 11, skill_name: 'Gemini' },
  ],
  sections: [{ id: 2, title: 'Skills' }],
  used_by: [SENT],
}
const CLAUDE: Skill = {
  skill_id: 10,
  skill_name: 'Claude',
  categories: [{ category_id: 6, category_name: 'AI' }],
  projects: [{ project_id: 4, project_title: 'Tweaker', done_for: 'Independent Project' }],
  used_by: [SENT],
}
const GEMINI: Skill = { ...CLAUDE, skill_id: 11, skill_name: 'Gemini', projects: [], used_by: [] }
const SECTIONS: Section[] = [{ id: 2, title: 'Skills', built_in: true, skill_categories: [], used_by: [] }]

function stub(extra: Record<string, Reply[]> = {}) {
  const twice = (body: unknown) => [
    { status: 200, body },
    { status: 200, body },
  ]
  return stubApi({
    'GET /api/skill-categories': twice([OTHER, AI]),
    'GET /api/skills': twice([CLAUDE, GEMINI]),
    'GET /api/sections': twice(SECTIONS),
    ...extra,
  })
}

const categoryCard = async (name: string) =>
  (await screen.findByRole('heading', { name: new RegExp(`^${name}`) })).closest('article') as HTMLElement

describe('SkillsPage', () => {
  it('shows each category with its skills, sections, and uses', async () => {
    stub()
    render(<SkillsPage />)
    const ai = await categoryCard('AI')
    expect(within(ai).getByText('Sections that list it (1)')).toBeInTheDocument()
    expect(within(ai).getByText('Skills', { selector: 'li' })).toBeInTheDocument()
    expect(within(ai).getAllByRole('listitem').map((item) => item.textContent)).toContain('Resume: Acme resumesent')
    const other = await categoryCard('Other')
    expect(within(other).queryByText('Delete')).not.toBeInTheDocument()
  })

  it('saves a reordered skill list', async () => {
    const fetchMock = stub({ 'PUT /api/skill-categories/6/skills': [{ status: 200, body: AI }] })
    render(<SkillsPage />)
    fireEvent.click(within(await categoryCard('AI')).getByLabelText('Move Gemini up'))
    await screen.findAllByText('Gemini')
    await new Promise((resolve) => setTimeout(resolve))
    expect(sentBody(fetchMock, 'PUT /api/skill-categories/6/skills')).toEqual({ skill_ids: [11, 10] })
  })

  it('adds a new skill to the category it was typed in', async () => {
    const fetchMock = stub({ 'POST /api/skills': [{ status: 201, body: GEMINI }] })
    render(<SkillsPage />)
    const ai = await categoryCard('AI')
    fireEvent.change(within(ai).getByLabelText('New skill in AI'), { target: { value: 'Claude Code' } })
    fireEvent.click(within(ai).getByText('Add skill'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(sentBody(fetchMock, 'POST /api/skills')).toEqual({ skill_name: 'Claude Code', category_id: 6 })
  })

  it('adds a category under the chosen section, or none', async () => {
    const fetchMock = stub({ 'POST /api/skill-categories': [{ status: 201, body: AI }] })
    render(<SkillsPage />)
    fireEvent.change(await screen.findByLabelText('List the new category under'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'Cloud' } })
    fireEvent.click(screen.getByText('Add category'))
    expect(await screen.findByRole('status')).toHaveTextContent('Added "Cloud".')
    expect(sentBody(fetchMock, 'POST /api/skill-categories')).toEqual({ category_name: 'Cloud', section_id: null })
  })

  it('warns that renaming a skill a sent version uses saves a new one', async () => {
    const saved = { ...CLAUDE, skill_id: 12, skill_name: 'Claude Code', used_by: [] }
    stub({ 'PUT /api/skills/10': [{ status: 200, body: saved }] })
    render(<SkillsPage />)
    const claude = (await screen.findAllByRole('heading', { name: 'Claude' }))[0].closest('article') as HTMLElement
    expect(within(claude).getByText(/Tweaker \(Independent Project\)/)).toBeInTheDocument()
    fireEvent.click(within(claude).getByText('Rename'))
    expect(screen.getByText(/saved as a new skill/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'Claude Code' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent versions keep "Claude".')
  })

  it('explains that deleting a category keeps its skills under "Other"', async () => {
    stub({ 'DELETE /api/skill-categories/6': [{ status: 204 }] })
    render(<SkillsPage />)
    fireEvent.click(within(await categoryCard('AI')).getByText('Delete'))
    const confirm = screen.getByRole('group', { name: 'Confirm delete' })
    expect(confirm).toHaveTextContent('They keep showing its skills, under "Other".')
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted "AI".')
  })
})
