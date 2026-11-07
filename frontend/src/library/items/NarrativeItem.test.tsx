import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NarrativeContent } from '../../shared/api/narrativeContent'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { sentBody, stubApi } from '../../test/stubApi'
import NarrativeItem from './NarrativeItem'

const INTRO: NarrativeContent = { hidden: false, content_id: 12, content: 'I build tools.', sections: [{ id: 1, title: 'Summary' }], used_by: [] }
const SECTIONS = [1, 9].map((id) => ({
  id,
  title: id === 1 ? 'Summary' : 'Outro',
  built_in: id === 1,
  narrative_content: [],
  skill_categories: [],
  experience: [],
  projects: [],
  bullets: [],
  education: [],
  used_by: [],
}))

const SENT = { kind: 'cover_letter' as const, id: 2, name: 'Sent letter', locked: true }
const DRAFT = { kind: 'cover_letter' as const, id: 3, name: 'Draft letter', locked: false }
const RESUME = { kind: 'resume' as const, id: 5, name: 'Draft resume', locked: false }
const IN_USE: NarrativeContent = { ...INTRO, used_by: [SENT, DRAFT, RESUME] }
const CHOICE = 'Apply this change to which resumes and cover letters in progress?'

function stubInUse(saved: NarrativeContent) {
  return stubApi({
    'GET /api/narrative-content': [{ status: 200, body: [IN_USE] }],
    'GET /api/sections': [{ status: 200, body: SECTIONS }],
    'PUT /api/narrative-content/12': [{ status: 200, body: saved }],
  })
}

describe('NarrativeItem', () => {
  it('saves the text with the sections checked', async () => {
    const fetchMock = stubApi({
      'GET /api/narrative-content': [{ status: 200, body: [INTRO] }],
      'GET /api/sections': [{ status: 200, body: SECTIONS }],
      'PUT /api/narrative-content/12': [{ status: 200, body: INTRO }],
    })
    const host = await renderItem(<NarrativeItem id={12} />)
    expect(screen.getByRole('checkbox', { name: 'Summary' })).toBeChecked()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Outro' }))
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() => expect(host.saved).toHaveBeenCalledWith('Saved.', { kind: 'narrative', id: 12 }))
    expect(sentBody(fetchMock, 'PUT /api/narrative-content/12')).toEqual({ content: 'I build tools.', section_ids: [1, 9], apply_to: [] })
  })

  it('asks which resumes and cover letters in progress get an edit, none to start', async () => {
    const fetchMock = stubInUse({ ...IN_USE, content_id: 14, content: 'I build small tools.', used_by: [DRAFT] })
    const host = await renderItem(<NarrativeItem id={12} />)
    const choice = screen.getByRole('group', { name: CHOICE })
    // Sent versions never change, so only the ones in progress are offered, A to Z.
    expect(within(choice).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Cover letter: Draft letter',
      'Resume: Draft resume',
    ])
    expect(within(choice).getByRole('checkbox', { name: 'Cover letter: Draft letter' })).not.toBeChecked()
    await expectNoA11yViolations()
    fireEvent.click(within(choice).getByRole('checkbox', { name: 'Cover letter: Draft letter' }))
    fireEvent.change(screen.getByLabelText('Narrative content text (required)'), { target: { value: 'I build small tools.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "I build small tools.". The ones in progress you checked use it now; everything else keeps "I build tools.".',
        { kind: 'narrative', id: 14 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/narrative-content/12')).toEqual({
      content: 'I build small tools.',
      section_ids: [1],
      apply_to: [{ kind: 'cover_letter', id: 3 }],
    })
  })

  it('applies an edit made from a cover letter’s tree to that letter, and asks only about the others', async () => {
    const fetchMock = stubInUse({ ...IN_USE, content_id: 14, content: 'I build small tools.', used_by: [DRAFT] })
    const host = await renderItem(<NarrativeItem id={12} />, {
      doc: 'cover letter',
      where: { kind: 'cover_letter', id: 3 },
    })
    expect(screen.getByLabelText('Narrative content text (required)')).toHaveAccessibleDescription(
      /Saving changes it in this cover letter, and in the others you check below\.$/,
    )
    const choice = screen.getByRole('group', { name: 'Apply this change to which other resumes and cover letters in progress?' })
    expect(within(choice).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual(['Resume: Draft resume'])
    await expectNoA11yViolations()
    fireEvent.change(screen.getByLabelText('Narrative content text (required)'), { target: { value: 'I build small tools.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(host.saved).toHaveBeenCalledWith(
        'Saved as a new version, "I build small tools.", which this cover letter uses now. Everything else keeps "I build tools.".',
        { kind: 'narrative', id: 14 },
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/narrative-content/12')).toMatchObject({ apply_to: [{ kind: 'cover_letter', id: 3 }] })
  })

  it("doesn't ask when nothing in progress uses it", async () => {
    stubApi({
      'GET /api/narrative-content': [{ status: 200, body: [{ ...INTRO, used_by: [SENT] }] }],
      'GET /api/sections': [{ status: 200, body: SECTIONS }],
    })
    await renderItem(<NarrativeItem id={12} />)
    expect(screen.queryByRole('group', { name: CHOICE })).not.toBeInTheDocument()
  })
})
