import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Section } from '../../shared/api/sections'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { sentBody, stubApi } from '../../test/stubApi'
import SectionItem from './SectionItem'

const SKILLS: Section = {
  hidden: false,
  id: 2,
  title: 'Skills',
  built_in: true,
  narrative_content: [{ content_id: 12, content: 'I build tools.' }],
  skill_categories: [{ category_id: 3, category_name: 'Back End' }],
  experience: [],
  projects: [],
  bullets: [],
  education: [],
  used_by: [],
}

function stub(extra = {}) {
  const empty = [{ status: 200, body: [] }]
  return stubApi({
    'GET /api/sections': [{ status: 200, body: [SKILLS] }],
    'GET /api/skill-categories': empty,
    'GET /api/experience': empty,
    'GET /api/projects': empty,
    'GET /api/bullet-points': empty,
    'GET /api/narrative-content': empty,
    'GET /api/education': empty,
    ...extra,
  })
}

describe('SectionItem', () => {
  it('can’t hide or delete a built-in section, notes a new title saves a new one, and opens its lists', async () => {
    stub()
    const host = await renderItem(<SectionItem id={2} />)
    expect(screen.getByLabelText('Section title')).toHaveAccessibleDescription('Built-in sections keep their title, so saving adds a new section.')
    expect(screen.queryByRole('button', { name: /^Delete "/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Hide "/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New version/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Back End' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'category', id: 3, title: 'Back End' })
    fireEvent.click(screen.getByRole('button', { name: 'I build tools.' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'narrative', id: 12, title: 'I build tools.' })
  })

  it('renames a built-in section from a resume’s tree into a new section for that resume', async () => {
    const draft = { kind: 'resume' as const, id: 3, name: 'Draft', locked: false }
    const fetchMock = stub({
      'GET /api/sections': [{ status: 200, body: [{ ...SKILLS, used_by: [draft] }] }],
      'PUT /api/sections/2': [{ status: 200, body: { ...SKILLS, id: 9, built_in: false, title: 'Tools', used_by: [draft] } }],
    })
    const host = await renderItem(<SectionItem id={2} />, { doc: 'resume', where: { kind: 'resume', id: 3 } })
    expect(screen.getByLabelText('Section title')).toHaveAccessibleDescription(
      'Built-in sections keep their title, so saving adds a new section. Saving changes it in this resume only.',
    )
    expect(screen.queryByRole('group', { name: /^Apply this change/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Section title'), { target: { value: 'Tools' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "Tools", which this resume uses now. Everything else keeps "Skills".',
        { kind: 'section', id: 9 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/sections/2')).toEqual({ title: 'Tools', apply_to: [{ kind: 'resume', id: 3 }] })
  })
})
