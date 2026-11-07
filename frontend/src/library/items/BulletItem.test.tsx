import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Bullet } from '../../shared/api/bullets'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { sentBody, stubApi } from '../../test/stubApi'
import BulletItem from './BulletItem'

const BULLET: Bullet = {
  hidden: false,
  bullet_id: 10,
  content: 'Shipped it',
  experience: [{ experience_id: 4, role_title: 'Engineer', organization: 'Acme', dates: null }],
  projects: [{ project_id: 6, project_title: 'Tweaker', done_for: null }],
  sections: [],
  used_by: [],
}

const SENT = { kind: 'resume' as const, id: 2, name: 'Sent resume', locked: true }
const DRAFT = { kind: 'resume' as const, id: 3, name: 'Draft resume', locked: false }
const LETTER = { kind: 'cover_letter' as const, id: 5, name: 'Draft letter', locked: false }
const IN_USE: Bullet = { ...BULLET, used_by: [SENT, DRAFT, LETTER] }
const CHOICE = 'Apply this change to which resumes and cover letters in progress?'

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

  it('asks which resumes and cover letters in progress get an edit, none to start', async () => {
    const saved = { ...IN_USE, bullet_id: 12, content: 'Shipped it twice', used_by: [DRAFT] }
    const fetchMock = stubApi({
      'GET /api/bullet-points': [{ status: 200, body: [IN_USE] }],
      'PUT /api/bullet-points/10': [{ status: 200, body: saved }],
    })
    const host = await renderItem(<BulletItem id={10} />)
    const choice = screen.getByRole('group', { name: CHOICE })
    // Sent versions never change, so only the ones in progress are offered, A to Z.
    expect(within(choice).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Cover letter: Draft letter',
      'Resume: Draft resume',
    ])
    expect(within(choice).getByRole('checkbox', { name: 'Resume: Draft resume' })).not.toBeChecked()
    await expectNoA11yViolations()
    fireEvent.click(within(choice).getByRole('checkbox', { name: 'Resume: Draft resume' }))
    fireEvent.change(screen.getByLabelText('Bullet text'), { target: { value: 'Shipped it twice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "Shipped it twice". The ones in progress you checked use it now; everything else keeps "Shipped it".',
        { kind: 'bullet', id: 12 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/bullet-points/10')).toEqual({
      content: 'Shipped it twice',
      apply_to: [{ kind: 'resume', id: 3 }],
    })
  })

  it('says everything keeps the original when none are checked', async () => {
    const saved = { ...IN_USE, bullet_id: 12, content: 'Shipped it twice', used_by: [] }
    stubApi({
      'GET /api/bullet-points': [{ status: 200, body: [IN_USE] }],
      'PUT /api/bullet-points/10': [{ status: 200, body: saved }],
    })
    const host = await renderItem(<BulletItem id={10} />)
    fireEvent.change(screen.getByLabelText('Bullet text'), { target: { value: 'Shipped it twice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "Shipped it twice". Everything that used "Shipped it" still does; pick the new version where you want it.',
        { kind: 'bullet', id: 12 },
      ),
    )
  })

  it("doesn't ask when nothing in progress uses it", async () => {
    stubApi({ 'GET /api/bullet-points': [{ status: 200, body: [{ ...BULLET, used_by: [SENT] }] }] })
    await renderItem(<BulletItem id={10} />)
    expect(screen.queryByRole('group', { name: CHOICE })).not.toBeInTheDocument()
  })

  it('applies an edit made from a resume’s tree to that resume, and asks only about the others', async () => {
    const saved = { ...IN_USE, bullet_id: 12, content: 'Shipped it twice', used_by: [DRAFT, LETTER] }
    const fetchMock = stubApi({
      'GET /api/bullet-points': [{ status: 200, body: [IN_USE] }],
      'PUT /api/bullet-points/10': [{ status: 200, body: saved }],
    })
    const host = await renderItem(<BulletItem id={10} />, { doc: 'resume', where: { kind: 'resume', id: 3 } })
    expect(screen.getByLabelText('Bullet text')).toHaveAccessibleDescription(
      /sent version keeps this one\. Saving changes it in this resume, and in the others you check below\.$/,
    )
    const choice = screen.getByRole('group', { name: 'Apply this change to which other resumes and cover letters in progress?' })
    expect(within(choice).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual(['Cover letter: Draft letter'])
    await expectNoA11yViolations()
    fireEvent.click(within(choice).getByRole('checkbox', { name: 'Cover letter: Draft letter' }))
    fireEvent.change(screen.getByLabelText('Bullet text'), { target: { value: 'Shipped it twice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "Shipped it twice", which this resume uses now, as do the others you checked. Everything else keeps "Shipped it".',
        { kind: 'bullet', id: 12 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/bullet-points/10')).toEqual({
      content: 'Shipped it twice',
      apply_to: [{ kind: 'resume', id: 3 }, { kind: 'cover_letter', id: 5 }],
    })
  })
})
