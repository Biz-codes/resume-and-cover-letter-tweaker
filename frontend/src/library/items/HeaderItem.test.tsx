import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Header } from '../../shared/api/headers'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { sentBody, stubApi } from '../../test/stubApi'
import HeaderItem from './HeaderItem'

const HEADER: Header = {
  hidden: false,
  header_id: 1,
  created_at: '2026-10-01T09:00:00',
  full_name: 'Sam Rivera',
  headline: null,
  email: null,
  phone: null,
  location: null,
  linkedin_url: null,
  github_url: null,
  portfolio_url: null,
  used_by: [],
  in_progress: [],
}

const POSTING = { kind: 'job_posting' as const, id: 4, name: 'Acme: Engineer', locked: false }
const BASE = { kind: 'resume' as const, id: 2, name: 'Tech Base Resume', locked: false }
const SENT = { kind: 'resume' as const, id: 6, name: 'Sent resume', locked: true }

describe('HeaderItem', () => {
  it('asks which postings and base documents in progress get a change, and has no New version', async () => {
    const inUse = { ...HEADER, used_by: [POSTING, BASE, SENT], in_progress: [POSTING, BASE] }
    const fetchMock = stubApi({
      'GET /api/headers': [{ status: 200, body: [inUse] }],
      'PUT /api/headers/1': [{ status: 200, body: { ...inUse, header_id: 9, headline: 'Engineer', used_by: [POSTING], in_progress: [POSTING] } }],
    })
    const host = await renderItem(<HeaderItem id={1} />)
    expect(screen.queryByRole('button', { name: /New version/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Full name (required)')).toHaveAccessibleDescription(
      /^A sent version uses this header, .* Saving changes it only in the ones you check below; the rest keep it as it is\.$/,
    )
    const choice = screen.getByRole('group', { name: 'Apply this change to which resumes and cover letters in progress?' })
    // A posting's resumes and cover letters go with it, so the posting is what's offered.
    expect(within(choice).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Job posting: Acme: Engineer',
      'Resume: Tech Base Resume',
    ])
    await expectNoA11yViolations()
    fireEvent.click(within(choice).getByRole('checkbox', { name: 'Job posting: Acme: Engineer' }))
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Engineer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "Sam Rivera, Engineer". The ones in progress you checked use it now; everything else keeps "Sam Rivera".',
        { kind: 'header', id: 9 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/headers/1')).toMatchObject({ headline: 'Engineer', apply_to: [{ kind: 'job_posting', id: 4 }] })
  })

  it('has no note or checklist when nothing uses it', async () => {
    stubApi({ 'GET /api/headers': [{ status: 200, body: [HEADER] }] })
    await renderItem(<HeaderItem id={1} />)
    expect(screen.getByLabelText('Full name (required)')).not.toHaveAccessibleDescription()
    expect(screen.queryByRole('group', { name: /^Apply this change/ })).not.toBeInTheDocument()
  })
})
