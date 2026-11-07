import { fireEvent, screen, within } from '@testing-library/react'
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

const DRAFT = { kind: 'resume' as const, id: 3, name: 'Draft resume', locked: false }
const LETTER = { kind: 'cover_letter' as const, id: 5, name: 'Draft letter', locked: false }

describe('EducationItem', () => {
  it('applies an edit made from a resume’s tree to that resume and the others checked', async () => {
    const inUse = { ...DEGREE, used_by: [DRAFT, LETTER] }
    const fetchMock = stubApi({
      'GET /api/education': [{ status: 200, body: [inUse] }],
      'PUT /api/education/7': [{ status: 200, body: { ...inUse, education_id: 8, graduation: '2015' } }],
    })
    const host = await renderItem(<EducationItem id={7} />, { doc: 'resume', where: { kind: 'resume', id: 3 } })
    expect(screen.queryByRole('button', { name: /New version/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Degree/)).toHaveAccessibleDescription('Saving changes it in this resume, and in the others you check below.')
    const choice = screen.getByRole('group', { name: 'Apply this change to which other resumes and cover letters in progress?' })
    await expectNoA11yViolations()
    fireEvent.click(within(choice).getByRole('checkbox', { name: 'Cover letter: Draft letter' }))
    fireEvent.change(screen.getByLabelText(/^Graduation/), { target: { value: '2015' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "B.A., State (2015)", which this resume uses now, as do the others you checked. Everything else keeps "B.A., State".',
        { kind: 'education', id: 8 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/education/7')).toMatchObject({
      graduation: '2015',
      apply_to: [{ kind: 'resume', id: 3 }, { kind: 'cover_letter', id: 5 }],
    })
  })
})
