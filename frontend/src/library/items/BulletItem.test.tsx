import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Bullet } from '../../shared/api/bullets'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
import BulletItem from './BulletItem'

const BULLET: Bullet = {
  bullet_id: 10,
  content: 'Shipped it',
  experience: [{ experience_id: 4, role_title: 'Engineer', organization: 'Acme', dates: null }],
  projects: [{ project_id: 6, project_title: 'Tweaker', done_for: null }],
  sections: [],
  used_by: [],
}

describe('BulletItem', () => {
  it('opens the roles and projects that list it in the same dialog', async () => {
    stubApi({ 'GET /api/bullet-points': [{ status: 200, body: [BULLET] }] })
    const host = await renderItem(<BulletItem id={10} />)
    expect(screen.getByLabelText('Bullet text')).toHaveValue('Shipped it')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Engineer, Acme' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'experience', id: 4, title: 'Engineer, Acme' })
    fireEvent.click(screen.getByRole('button', { name: 'Tweaker' }))
    expect(host.open).toHaveBeenLastCalledWith({ kind: 'project', id: 6, title: 'Tweaker' })
  })
})
