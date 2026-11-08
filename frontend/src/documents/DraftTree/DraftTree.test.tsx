import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { Draft, DraftSection } from '../../shared/api/documents'
import { expectNoA11yViolations } from '../../test/axe'
import { errorBody, stubApi } from '../../test/stubApi'
import DraftTree from './DraftTree'

const empty = { skill_categories: [], experience: [], projects: [], bullets: [], education: [], used_by: [] }
const SECTIONS = [
  { id: 1, title: 'Summary', built_in: true, ...empty, narrative_content: [{ content_id: 6, content: 'Builds accessible apps.' }] },
  {
    id: 3,
    title: 'Experience',
    built_in: true,
    narrative_content: [],
    ...empty,
    experience: [{ experience_id: 7, role_title: 'Engineer', organization: 'Acme', dates: null }],
    skill_categories: [{ category_id: 2, category_name: 'Front End' }],
  },
  { id: 12, title: 'Talks', built_in: false, narrative_content: [], ...empty },
]
const LEAD = { bullet_id: 8, content: 'Led the redesign.' }
const CUT = { bullet_id: 9, content: 'Cut load time in half.' }
const LIBRARY: Record<string, unknown[]> = {
  sections: SECTIONS,
  'narrative-content': [{ content_id: 6, content: 'Builds accessible apps.', sections: [], used_by: [] }],
  'skill-categories': [
    {
      category_id: 2,
      category_name: 'Front End',
      built_in: false,
      skills: [
        { skill_id: 1, skill_name: 'React', hidden: false },
        { skill_id: 3, skill_name: 'CSS', hidden: false },
      ],
      sections: [],
      used_by: [],
    },
  ],
  experience: [
    {
      experience_id: 7,
      role_title: 'Engineer',
      organization: 'Acme',
      location: null,
      dates: null,
      bullets: [LEAD, CUT],
      sections: [],
      used_by: [],
    },
  ],
  projects: [],
  'bullet-points': [LEAD, CUT].map((bullet) => ({ ...bullet, experience: [], projects: [], sections: [], used_by: [] })),
  education: [],
}

const DRAFT: Draft = {
  starting_document: { id: 4, name: 'Tech Base Resume' },
  starting_reason: 'It was made for a similar role.',
  texts: [
    { key: 1, kind: 'narrative', text: 'Builds accessible React apps.', replaces: 6 },
    { key: 2, kind: 'narrative', text: 'Teaches web basics.', replaces: null },
    { key: 3, kind: 'bullet', text: 'Led the React redesign.', replaces: 8 },
  ],
  sections: [
    {
      section_id: 1,
      reason: 'The posting asks for a short summary.',
      entries: [
        { kind: 'narrative', item_id: 6, text_key: 1, reason: 'Names React, which the posting asks for.' },
        { kind: 'narrative', item_id: null, text_key: 2, reason: 'The posting mentions mentoring.' },
      ],
    },
    {
      section_id: 3,
      reason: 'The posting wants front end work.',
      entries: [
        {
          kind: 'experience',
          item_id: 7,
          reason: 'Closest to this role.',
          bullets: [{ bullet_id: 8, text_key: 3, reason: 'Uses the posting’s keywords.' }],
        },
        { kind: 'category', item_id: 2, reason: 'The skills it names.', skill_ids: [1] },
      ],
    },
  ],
}

function stubLibrary() {
  return stubApi(
    Object.fromEntries(Object.entries(LIBRARY).map(([path, body]) => [`GET /api/${path}`, [{ status: 200, body }]])),
  )
}

function renderDraft(draft: Draft = DRAFT, onFinish = vi.fn(() => Promise.resolve())) {
  const onChange = vi.fn((_sections: DraftSection[], _notice?: string) => Promise.resolve())
  render(
    <MemoryRouter>
      <DraftTree kind="resume" draft={draft} onChange={onChange} onFinish={onFinish} />
    </MemoryRouter>,
  )
  return { onChange, onFinish }
}

async function expand(name: string) {
  const toggle = await screen.findByRole('button', { name })
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

async function rowNames(list: string) {
  const group = await screen.findByRole('group', { name: list })
  return within(group)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.item-name')?.textContent)
}

// The sections the last change sent.
const sent = (onChange: { mock: { calls: [DraftSection[], string?][] } }) => onChange.mock.calls.at(-1)![0]

describe('DraftTree', () => {
  it('shows where Claude started and why, then each section with its reason', async () => {
    stubLibrary()
    renderDraft()
    expect(screen.getByText('Loading your library…')).toBeInTheDocument()
    expect(await rowNames('Sections')).toEqual(['Summary', 'Experience'])
    expect(screen.getByRole('link', { name: 'Tech Base Resume' })).toHaveAttribute('href', '/resumes/4')
    expect(screen.getByText(/It was made for a similar role\./)).toBeInTheDocument()
    await expectNoA11yViolations()
    await expand('Summary')
    expect(screen.getByText('Claude: The posting asks for a short summary.')).toBeInTheDocument()
    // Claude's wording is what's shown.
    expect(await rowNames('Items in Summary')).toEqual(['Text: Builds accessible React apps.', 'Text: Teaches web basics.'])
    await expectNoA11yViolations()
  })

  it('says Claude started from the library when there was no earlier one', async () => {
    stubLibrary()
    renderDraft({ ...DRAFT, starting_document: null, starting_reason: 'There are no earlier resumes.' })
    expect(await screen.findByText('Claude started from your library. There are no earlier resumes.')).toBeInTheDocument()
  })

  it("shows the original beside Claude's wording, with a way back, and marks new text", async () => {
    stubLibrary()
    const { onChange } = renderDraft()
    await expand('Summary')
    await expand('Text: Builds accessible React apps. in Summary')
    expect(screen.getByText('Claude: Names React, which the posting asks for.')).toBeInTheDocument()
    expect(screen.getByText('Claude’s wording. Original: “Builds accessible apps.”'.replace('’', "'"))).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Use the original wording of Text: "Builds accessible React apps." in Summary' }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][1]).toBe('Using the original wording.')
    expect(sent(onChange)[0].entries[0]).toEqual({ ...DRAFT.sections[0].entries[0], use_original: true })
    // New text has no original to go back to; taking it out is the way back.
    await expand('Text: Teaches web basics. in Summary')
    expect(screen.getByText('New text from Claude.')).toBeInTheDocument()
  })

  it("goes back to Claude's wording from the original", async () => {
    stubLibrary()
    const draft = structuredClone(DRAFT)
    draft.sections[0].entries[0].use_original = true
    const { onChange } = renderDraft(draft)
    await expand('Summary')
    // The original is what's shown now.
    await expand('Text: Builds accessible apps. in Summary')
    expect(screen.getByText(/Your original wording\. Claude's: “Builds accessible React apps\.”/)).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: `Use Claude's wording of Text: "Builds accessible apps." in Summary` }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][1]).toBe("Using Claude's wording.")
    expect(sent(onChange)[0].entries[0].use_original).toBe(false)
  })

  it("shows a role's bullets with Claude's wording, and its category's skills", async () => {
    stubLibrary()
    const { onChange } = renderDraft()
    await expand('Experience')
    await expand('Role: Engineer, Acme in Experience')
    expect(screen.getByText('Claude: Closest to this role.')).toBeInTheDocument()
    expect(await rowNames('Engineer, Acme bullets')).toEqual(['Led the React redesign.'])
    await expand('Led the React redesign. under Engineer, Acme in Experience')
    expect(screen.getByText('Claude: Uses the posting’s keywords.')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Use the original wording of "Led the React redesign." under Engineer, Acme in Experience',
      }),
    )
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(sent(onChange)[1].entries[0].bullets).toEqual([{ ...DRAFT.sections[1].entries[0].bullets![0], use_original: true }])
    await expand('Skills: Front End in Experience')
    expect(await rowNames('Front End skills')).toEqual(['React'])
    await expectNoA11yViolations()
  })

  it('takes an item out, and adds what the library lists from More options', async () => {
    stubLibrary()
    const { onChange } = renderDraft()
    await expand('Summary')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Text: "Teaches web basics." in Summary' }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(sent(onChange)[0].entries).toEqual([DRAFT.sections[0].entries[0]])
    // A bullet the role lists, swapped in.
    await expand('Experience')
    await expand('Role: Engineer, Acme in Experience')
    fireEvent.click(screen.getByRole('button', { name: /^More options for Engineer, Acme bullets/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cut load time in half.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add checked to Engineer, Acme bullets' }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
    expect(sent(onChange)[1].entries[0].bullets).toEqual([...DRAFT.sections[1].entries[0].bullets!, { bullet_id: 9 }])
  })

  it('adds a section, which starts empty, and an item with every skill it lists', async () => {
    stubLibrary()
    const draft = { ...DRAFT, sections: [{ section_id: 3, reason: '', entries: [] }] }
    const { onChange } = renderDraft(draft)
    fireEvent.click(await screen.findByRole('button', { name: /^More options for Sections/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Talks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add checked to Sections' }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(sent(onChange).map((section: { section_id: number }) => section.section_id)).toEqual([3, 12])
    await expand('Experience')
    // An empty section has no reason, and opens its More options.
    expect(screen.queryByText(/^Claude:/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Skills: Front End' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add checked to Items in Experience' }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
    expect(sent(onChange)[0].entries).toEqual([{ kind: 'category', item_id: 2, skill_ids: [1, 3], bullets: [] }])
  })

  it('finishes right away when Claude wrote nothing the draft leaves out', async () => {
    stubLibrary()
    const { onFinish } = renderDraft({ ...DRAFT, texts: [], sections: [{ section_id: 12, entries: [] }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Finish review' }))
    expect(onFinish).toHaveBeenCalledWith([])
    expect(await screen.findByRole('button', { name: 'Finishing…' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("asks which of Claude's unused texts to keep, then finishes", async () => {
    stubLibrary()
    const draft = structuredClone(DRAFT)
    // The rewording went back to the original, and the new text was taken out.
    draft.sections[0].entries = [{ ...draft.sections[0].entries[0], use_original: true }]
    const { onFinish } = renderDraft(draft)
    fireEvent.click(await screen.findByRole('button', { name: 'Finish review' }))
    const dialog = screen.getByRole('dialog', { name: "Claude's text you didn't use" })
    const group = within(dialog).getByRole('group', { name: 'Keep in your library for later' })
    expect(within(group).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Builds accessible React apps.',
      'Teaches web basics.',
    ])
    await expectNoA11yViolations()
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Teaches web basics.' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Finish review' }))
    expect(onFinish).toHaveBeenCalledWith([2])
  })

  it('shows a refusal in the dialog, and cancels back to Finish review', async () => {
    stubLibrary()
    const draft = structuredClone(DRAFT)
    draft.sections[0].entries = [draft.sections[0].entries[0]]
    renderDraft(draft, vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'Something moved.', 'sections', 422))))
    const finish = await screen.findByRole('button', { name: 'Finish review' })
    fireEvent.click(finish)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Finish review' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something moved.')
    await expectNoA11yViolations()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await vi.waitFor(() => expect(finish).toHaveFocus())
    // Shown under the button too once the dialog is closed.
    expect(screen.getByRole('alert')).toHaveTextContent('Something moved.')
  })

  it('offers Retry when the library fails to load', async () => {
    stubApi({
      ...Object.fromEntries(Object.entries(LIBRARY).map(([path, body]) => [`GET /api/${path}`, [{ status: 200, body }]])),
      'GET /api/sections': [{ status: 404, body: errorBody('NOT_FOUND', 'Not found.') }, { status: 200, body: SECTIONS }],
    })
    renderDraft()
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await rowNames('Sections')).toEqual(['Summary', 'Experience'])
  })
})
