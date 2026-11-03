import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Section } from '../shared/api/sections'
import type { Skill, SkillCategory } from '../shared/api/skills'
import { findCard, openItem } from '../test/openCard'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import { expectNoA11yViolations } from '../test/axe'
import SkillsPage from './SkillsPage'
import { unsent } from '../test/unsent'
import { expectNotice } from '../test/notice'

const SENT = { kind: 'resume' as const, id: 2, name: 'Acme resume', locked: true }
const OTHER: SkillCategory = {
  hidden: false,
  category_id: 1,
  category_name: 'Other',
  built_in: true,
  skills: [],
  sections: [],
  used_by: [],
}
const AI: SkillCategory = {
  hidden: false,
  category_id: 6,
  category_name: 'AI',
  built_in: false,
  skills: [
    { hidden: false, skill_id: 10, skill_name: 'Claude' },
    { hidden: false, skill_id: 11, skill_name: 'Gemini' },
  ],
  sections: [{ id: 2, title: 'Skills' }],
  used_by: [SENT],
}
const CLAUDE: Skill = {
  hidden: false,
  skill_id: 10,
  skill_name: 'Claude',
  categories: [{ category_id: 6, category_name: 'AI' }],
  projects: [{ project_id: 4, project_title: 'Tweaker', done_for: 'Independent Project' }],
  used_by: [SENT],
}
const GEMINI: Skill = { ...CLAUDE, skill_id: 11, skill_name: 'Gemini', projects: [], used_by: [] }
const SECTIONS: Section[] = [
  { hidden: false, id: 2, title: 'Skills', built_in: true, narrative_content: [], skill_categories: [], experience: [], projects: [], bullets: [], education: [], used_by: [] },
]

function stub(extra: Record<string, Reply[]> = {}, categories = [OTHER, AI], skills = [CLAUDE, GEMINI]) {
  const twice = (body: unknown) => [
    { status: 200, body },
    { status: 200, body },
  ]
  return stubApi({
    'GET /api/skill-categories': twice(categories),
    'GET /api/skills': twice(skills),
    'GET /api/sections': twice(SECTIONS),
    ...extra,
  })
}

// A category's dialog. Its card's heading also holds its tags ("built in"), so match its start.
const categoryCard = (name: string) => openItem(new RegExp(`^${name}`))

describe('SkillsPage', () => {
  it('shows each category with its skills, sections, and uses', async () => {
    stub()
    render(<SkillsPage />)
    expect(document.title).toBe('Skills – Resume Tweaker')
    expect(within(await findCard(/^AI/)).getByText('Claude, Gemini')).toBeInTheDocument()
    const ai = await categoryCard('AI')
    expect(within(ai).getByText('Sections that list it (1)')).toBeInTheDocument()
    // Each section that lists it opens in the same dialog.
    expect(within(ai).getByRole('button', { name: 'Skills' })).toBeInTheDocument()
    expect(within(ai).getAllByRole('listitem').map((item) => item.textContent)).toContain('Resume: Acme resumesent')
    await expectNoA11yViolations()
    fireEvent.click(within(ai).getByRole('button', { name: 'Close' }))
    const other = await categoryCard('Other')
    expect(within(other).queryByText('Delete')).not.toBeInTheDocument()
    expect(within(other).queryByLabelText('Category name')).not.toBeInTheDocument()
    expect(within(other).getByRole('button', { name: /^New version of / })).toBeInTheDocument()
  })

  it('saves a reordered skill list', async () => {
    const fetchMock = stub({ 'PUT /api/skill-categories/6/skills': [{ status: 200, body: AI }] })
    render(<SkillsPage />)
    const handle = within(await categoryCard('AI')).getByRole('button', { name: 'Move Gemini' })
    fireEvent.click(handle)
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    fireEvent.click(handle)
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
    await vi.waitFor(() => expect(within(ai).getByRole('status')).toHaveTextContent('Added the skill "Claude Code".'))
  })

  it('adds a category under the chosen section, or none', async () => {
    const fetchMock = stub({ 'POST /api/skill-categories': [{ status: 201, body: AI }] })
    render(<SkillsPage />)
    fireEvent.change(await screen.findByLabelText('List the new category under'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'Cloud' } })
    fireEvent.click(screen.getByText('Add category'))
    await expectNotice('Added "Cloud".')
    expect(sentBody(fetchMock, 'POST /api/skill-categories')).toEqual({ category_name: 'Cloud', section_id: null })
  })

  it('warns that renaming a skill a sent version uses saves a new one', async () => {
    const saved = { ...CLAUDE, skill_id: 12, skill_name: 'Claude Code', used_by: [] }
    stub({ 'PUT /api/skills/10': [{ status: 200, body: saved }] })
    render(<SkillsPage />)
    const claude = await openItem('Claude')
    expect(within(claude).getByText(/Tweaker \(Independent Project\)/)).toBeInTheDocument()
    expect(screen.getByLabelText('Skill name')).toHaveAccessibleDescription(/saved as a new skill/)
    await expectNoA11yViolations()
    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'Claude Code' } })
    fireEvent.click(screen.getByText('Save'))
    await expectNotice('Sent versions keep "Claude".')
  })

  it('explains that deleting a category keeps its skills under "Other"', async () => {
    stub({ 'DELETE /api/skill-categories/6': [{ status: 204 }] }, [OTHER, unsent(AI)])
    render(<SkillsPage />)
    fireEvent.click(within(await categoryCard('AI')).getByRole('button', { name: /^Delete "/ }))
    const confirm = screen.getByRole('group', { name: 'Delete "AI"?' })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    expect(confirm).toHaveTextContent('They keep showing its skills, under "Other".')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    await expectNotice('Deleted "AI".')
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Skills' })).toHaveFocus())
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<SkillsPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the lists fail to load', async () => {
    stub({
      'GET /api/skills': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [CLAUDE, GEMINI] },
      ],
    })
    render(<SkillsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Retry'))
    expect(await categoryCard('AI')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says when there are no skills yet', async () => {
    stub({ 'GET /api/skills': [{ status: 200, body: [] }] })
    render(<SkillsPage />)
    const allSkills = await screen.findByRole('heading', { name: 'All skills' })
    expect(allSkills.nextElementSibling).toHaveTextContent('No skills yet.')
  })

  it('lists what uses a skill before deleting it, and returns focus on cancel', async () => {
    stub({}, undefined, [unsent(CLAUDE), GEMINI])
    render(<SkillsPage />)
    const dialog = await openItem('Claude')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete "/ }))
    const confirm = screen.getByRole('group', { name: 'Delete "Claude"?' })
    expect(confirm).toHaveTextContent('Used by: Acme resume.')
    expect(confirm).toHaveTextContent('from every category and project')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Cancel'))
    await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: /^Delete "/ })).toHaveFocus())
  })

  it('adds a new version of a category, and of a skill', async () => {
    const fetchMock = stub({
      'POST /api/skill-categories/6/versions': [{ status: 201, body: { ...AI, category_id: 8, category_name: 'ML' } }],
      'POST /api/skills/10/versions': [{ status: 201, body: { ...CLAUDE, skill_id: 13, skill_name: 'Claude Code' } }],
    })
    render(<SkillsPage />)
    fireEvent.click(within(await categoryCard('AI')).getByRole('button', { name: /^New version of / }))
    expect(screen.getByLabelText("New version's name")).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(screen.getByLabelText("New version's name"), { target: { value: 'ML' } })
    fireEvent.click(screen.getByText('Add version'))
    await expectNotice('Added "ML", with the same skills.')
    expect(sentBody(fetchMock, 'POST /api/skill-categories/6/versions')).toEqual({ category_name: 'ML' })
    fireEvent.click(within(await openItem('Claude')).getByRole('button', { name: /^New version of / }))
    fireEvent.change(screen.getByLabelText("New version's name"), { target: { value: 'Claude Code' } })
    fireEvent.click(screen.getByText('Add version'))
    await expectNotice('Added "Claude Code", listed right after "Claude".')
    expect(sentBody(fetchMock, 'POST /api/skills/10/versions')).toEqual({ skill_name: 'Claude Code' })
  })
})
