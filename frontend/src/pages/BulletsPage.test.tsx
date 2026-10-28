import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Bullet } from '../api/bullets'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import BulletsPage from './BulletsPage'

const SENT = { kind: 'resume' as const, id: 2, name: 'Acme resume', locked: true }
const SHIPPED: Bullet = {
  bullet_id: 10,
  content: 'Shipped the new checkout flow to every customer',
  experience: [
    { experience_id: 4, role_title: 'Engineer', organization: 'Acme', dates: '2020' },
    { experience_id: 5, role_title: 'Senior Engineer', organization: 'Acme', dates: null },
  ],
  projects: [{ project_id: 6, project_title: 'Tweaker', done_for: 'Freelance' }],
  sections: [],
  used_by: [SENT],
}
const LOOSE: Bullet = { ...SHIPPED, bullet_id: 11, content: 'Spoke at a conference', experience: [], projects: [], used_by: [] }
const LABEL = '"Shipped the new checkout flow to…"'

function stub(extra: Record<string, Reply[]> = {}, bullets = [SHIPPED, LOOSE]) {
  return stubApi({
    'GET /api/bullet-points': [
      { status: 200, body: bullets },
      { status: 200, body: bullets },
    ],
    ...extra,
  })
}

describe('BulletsPage', () => {
  it('shows where each bullet is listed, unlisted bullets first', async () => {
    stub()
    render(<BulletsPage />)
    expect(document.title).toBe('Bullet points – Resume Tweaker')
    const card = (await screen.findByRole('heading', { name: SHIPPED.content })).closest('article') as HTMLElement
    expect(within(card).getByText('Roles (2)')).toBeInTheDocument()
    expect(within(card).getByText('Engineer, Acme (2020)')).toBeInTheDocument()
    expect(within(card).getByText('Senior Engineer, Acme')).toBeInTheDocument()
    expect(within(card).getByText('Tweaker (Freelance)')).toBeInTheDocument()
    const unlisted = screen.getByRole('heading', { name: 'Not listed anywhere' })
    expect(unlisted.parentElement).toHaveTextContent('Spoke at a conference')
    await expectNoA11yViolations()
  })

  it('warns that editing a bullet a sent version uses saves a new bullet', async () => {
    const saved = { ...SHIPPED, bullet_id: 12, content: 'Shipped it', used_by: [] }
    const fetchMock = stub({ 'PUT /api/bullet-points/10': [{ status: 200, body: saved }] })
    render(<BulletsPage />)
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${LABEL}` }))
    const field = screen.getByLabelText('Bullet text')
    expect(field).toHaveFocus()
    expect(field).toHaveAccessibleDescription(/saved as a new bullet/)
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Shipped it' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved as a new bullet')
    expect(sentBody(fetchMock, 'PUT /api/bullet-points/10')).toEqual({ content: 'Shipped it' })
  })

  it('lists what a delete affects, then deletes', async () => {
    stub({ 'DELETE /api/bullet-points/10': [{ status: 204 }] })
    render(<BulletsPage />)
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${LABEL}` }))
    const confirm = screen.getByRole('group', { name: `Delete ${LABEL}?` })
    expect(within(confirm).getByText('Cancel')).toHaveFocus()
    expect(confirm).toHaveTextContent('from every role, project, and section')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByText('Delete'))
    expect(await screen.findByRole('status')).toHaveTextContent(`Deleted ${LABEL}.`)
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Bullet points' })).toHaveFocus())
  })

  it('says it is loading', async () => {
    stubPendingApi()
    render(<BulletsPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the list fails to load', async () => {
    stub({
      'GET /api/bullet-points': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [SHIPPED] },
      ],
    })
    render(<BulletsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByRole('heading', { name: SHIPPED.content })).toBeInTheDocument()
  })

  it('says when there are no bullets yet', async () => {
    stub({}, [])
    render(<BulletsPage />)
    expect(await screen.findByText('No bullets yet.')).toBeInTheDocument()
  })
})
