import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Experience } from '../../shared/api/experience'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
import ExperienceItem from './ExperienceItem'

const ROLE: Experience = {
  experience_id: 4,
  created_at: '2026-10-01T09:00:00',
  role_title: 'Engineer',
  organization: 'Acme',
  location: null,
  dates: '2020',
  bullets: [{ bullet_id: 10, content: 'Shipped it' }],
  sections: [{ id: 3, title: 'Experience' }],
  used_by: [],
}

describe('ExperienceItem', () => {
  it('saves the role, then asks the dialog to close and point to it', async () => {
    stubApi({
      'GET /api/experience': [{ status: 200, body: [ROLE] }],
      'GET /api/bullet-points': [{ status: 200, body: [] }],
      'PUT /api/experience/4': [{ status: 200, body: ROLE }],
    })
    const host = await renderItem(<ExperienceItem id={4} />)
    expect(screen.getByLabelText('Title (required)')).toHaveValue('Engineer')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() => expect(host.saved).toHaveBeenCalledWith('Saved.', { kind: 'experience', id: 4 }))
  })

  it('opens its bullets and sections in the same dialog', async () => {
    stubApi({
      'GET /api/experience': [{ status: 200, body: [ROLE] }],
      'GET /api/bullet-points': [{ status: 200, body: [] }],
    })
    const host = await renderItem(<ExperienceItem id={4} />)
    fireEvent.click(screen.getByRole('button', { name: 'Shipped it' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'bullet', id: 10, title: 'Shipped it' })
    fireEvent.click(screen.getByRole('button', { name: 'Experience' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'section', id: 3, title: 'Experience' })
  })

  it('says when the role is gone', async () => {
    stubApi({ 'GET /api/experience': [{ status: 200, body: [] }], 'GET /api/bullet-points': [{ status: 200, body: [] }] })
    await renderItem(<ExperienceItem id={4} />)
    expect(await screen.findByText("It's no longer in your library.")).toBeInTheDocument()
  })
})
