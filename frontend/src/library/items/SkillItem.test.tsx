import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Skill } from '../../shared/api/skills'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
import SkillItem from './SkillItem'

const CLAUDE: Skill = {
  hidden: false,
  skill_id: 10,
  skill_name: 'Claude',
  categories: [{ category_id: 6, category_name: 'AI' }],
  projects: [{ project_id: 6, project_title: 'Tweaker', done_for: 'Freelance' }],
  used_by: [],
}

describe('SkillItem', () => {
  it('opens the categories and projects that list it', async () => {
    stubApi({ 'GET /api/skills': [{ status: 200, body: [CLAUDE] }] })
    const host = await renderItem(<SkillItem id={10} />)
    expect(screen.getByLabelText('Skill name')).toHaveValue('Claude')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'category', id: 6, title: 'AI' })
    fireEvent.click(screen.getByRole('button', { name: 'Tweaker (Freelance)' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'project', id: 6, title: 'Tweaker (Freelance)' })
  })
})
