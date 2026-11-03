import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NarrativeContent } from '../../shared/api/narrativeContent'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { sentBody, stubApi } from '../../test/stubApi'
import NarrativeItem from './NarrativeItem'

const INTRO: NarrativeContent = { content_id: 12, content: 'I build tools.', sections: [{ id: 1, title: 'Summary' }], used_by: [] }
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
    expect(sentBody(fetchMock, 'PUT /api/narrative-content/12')).toEqual({ content: 'I build tools.', section_ids: [1, 9] })
  })
})
