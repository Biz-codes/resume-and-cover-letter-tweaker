import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Section } from '../../shared/api/sections'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
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

function stub() {
  const empty = [{ status: 200, body: [] }]
  stubApi({
    'GET /api/sections': [{ status: 200, body: [SKILLS] }],
    'GET /api/skill-categories': empty,
    'GET /api/experience': empty,
    'GET /api/projects': empty,
    'GET /api/bullet-points': empty,
    'GET /api/narrative-content': empty,
    'GET /api/education': empty,
  })
}

describe('SectionItem', () => {
  it('offers only a new version of a built-in section, and opens its lists', async () => {
    stub()
    const host = await renderItem(<SectionItem id={2} />)
    expect(screen.queryByLabelText('Section title')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete "/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Back End' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'category', id: 3, title: 'Back End' })
    fireEvent.click(screen.getByRole('button', { name: 'I build tools.' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'narrative', id: 12, title: 'I build tools.' })
  })
})
