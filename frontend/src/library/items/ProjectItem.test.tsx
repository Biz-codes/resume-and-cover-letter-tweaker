import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Project } from '../../shared/api/projects'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
import ProjectItem from './ProjectItem'

const PROJECT: Project = {
  hidden: false,
  project_id: 6,
  created_at: '2026-10-01T09:00:00',
  project_title: 'Tweaker',
  done_for: null,
  url: null,
  dates: null,
  skills: [{ hidden: false, skill_id: 20, skill_name: 'Python' }],
  bullets: [],
  sections: [],
  used_by: [],
}

describe('ProjectItem', () => {
  it('opens its skills in the same dialog, and deletes through the dialog', async () => {
    stubApi({
      'GET /api/projects': [{ status: 200, body: [PROJECT] }],
      'GET /api/skills': [{ status: 200, body: [] }],
      'GET /api/bullet-points': [{ status: 200, body: [] }],
      'DELETE /api/projects/6': [{ status: 204 }],
    })
    const host = await renderItem(<ProjectItem id={6} />)
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Python' }))
    expect(host.open).toHaveBeenCalledWith({ kind: 'skill', id: 20, title: 'Python' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await vi.waitFor(() => expect(host.deleted).toHaveBeenCalledWith('Deleted "Tweaker".'))
  })
})
