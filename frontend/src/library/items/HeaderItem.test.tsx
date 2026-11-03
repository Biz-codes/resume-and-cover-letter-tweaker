import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Header } from '../../shared/api/headers'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
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
}

describe('HeaderItem', () => {
  it('says when a version matches a header that already exists', async () => {
    stubApi({
      'GET /api/headers': [{ status: 200, body: [HEADER] }],
      'POST /api/headers/1/versions': [{ status: 200, body: HEADER }],
    })
    const host = await renderItem(<HeaderItem id={1} />)
    fireEvent.click(screen.getByRole('button', { name: 'New version' }))
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Add version'))
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith('A header with those values already exists, so no new one was added.', {
        kind: 'header',
        id: 1,
      }),
    )
  })
})
