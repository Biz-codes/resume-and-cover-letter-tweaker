import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Education } from '../../shared/api/education'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { sentBody, stubApi } from '../../test/stubApi'
import EducationItem from './EducationItem'

const DEGREE: Education = {
  hidden: false,
  education_id: 7,
  created_at: '2026-10-01T09:00:00',
  degree: 'B.A.',
  institution: 'State',
  details: null,
  graduation: null,
  sections: [{ id: 5, title: 'Education' }],
  used_by: [],
}

describe('EducationItem', () => {
  it('adds a version, then asks the dialog to close and point to it', async () => {
    const fetchMock = stubApi({
      'GET /api/education': [{ status: 200, body: [DEGREE] }],
      'POST /api/education/7/versions': [{ status: 201, body: { ...DEGREE, education_id: 8, graduation: '2015' } }],
    })
    const host = await renderItem(<EducationItem id={7} />)
    fireEvent.click(screen.getByRole('button', { name: 'New version' }))
    fireEvent.change(screen.getByLabelText(/^Graduation/), { target: { value: '2015' } })
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Add version'))
    await vi.waitFor(() => expect(host.saved).toHaveBeenCalledWith(expect.stringContaining('Added a new version'), { kind: 'education', id: 8 }))
    expect(sentBody(fetchMock, 'POST /api/education/7/versions')).toMatchObject({ graduation: '2015' })
  })
})
