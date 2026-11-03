import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SkillCategory } from '../../shared/api/skills'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
import CategoryItem from './CategoryItem'

const AI: SkillCategory = {
  hidden: false,
  category_id: 6,
  category_name: 'AI',
  built_in: false,
  skills: [{ hidden: false, skill_id: 10, skill_name: 'Claude' }],
  sections: [{ id: 2, title: 'Skills' }],
  used_by: [],
}

describe('CategoryItem', () => {
  it('opens its skills and sections, and says a skill added there', async () => {
    stubApi({
      'GET /api/skill-categories': [{ status: 200, body: [AI] }],
      'GET /api/skills': [{ status: 200, body: [] }],
      'POST /api/skills': [{ status: 201, body: {} }],
    })
    const host = await renderItem(<CategoryItem id={6} />)
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'skill', id: 10, title: 'Claude' })
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'section', id: 2, title: 'Skills' })
    fireEvent.change(screen.getByLabelText('New skill in AI'), { target: { value: 'Gemini' } })
    fireEvent.click(screen.getByText('Add skill'))
    await vi.waitFor(() => expect(host.say).toHaveBeenCalledWith('Added the skill "Gemini".'))
  })
})
