import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { Draft, DraftGreeting as Greeting, DraftSection, TreeSection } from '../../shared/api/documents'
import { expectNoA11yViolations } from '../../test/axe'
import { errorBody, stubApi } from '../../test/stubApi'
import DraftTree, { DraftGreeting } from './DraftTree'

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
          bullets: [
            { bullet_id: 8, text_key: 3, reason: 'Uses the posting’s keywords.' },
            { bullet_id: 9, reason: 'The posting asks about speed.' },
          ],
        },
        { kind: 'category', item_id: 2, reason: 'The skills it names.', skill_ids: [1, 3] },
      ],
    },
    { section_id: 12, reason: 'The posting mentions speaking.', entries: [] },
  ],
}

const child = (item_id: number, text: string) => ({ row_id: item_id, item_id, position: 1, text })
// What Claude started from: the summary sentence, and the role with one bullet and its category
// with one skill.
const START: TreeSection[] = [
  {
    row_id: 1,
    section_id: 1,
    title: 'Summary',
    entries: [{ kind: 'narrative', row_id: 1, item_id: 6, position: 1, values: {}, skills: [], bullets: [] }],
  },
  {
    row_id: 2,
    section_id: 3,
    title: 'Experience',
    entries: [
      { kind: 'experience', row_id: 2, item_id: 7, position: 1, values: {}, skills: [], bullets: [child(8, 'Led the redesign.')] },
      { kind: 'category', row_id: 3, item_id: 2, position: 2, values: {}, skills: [child(1, 'React')], bullets: [] },
    ],
  },
]

function stubLibrary(start: { status: number; body: unknown } = { status: 200, body: { sections: START } }) {
  return stubApi({
    ...Object.fromEntries(Object.entries(LIBRARY).map(([path, body]) => [`GET /api/${path}`, [{ status: 200, body }]])),
    'GET /api/resumes/4': [start],
  })
}

function renderDraft(draft: Draft = DRAFT, onFinish = vi.fn(() => Promise.resolve()), ownSections: TreeSection[] = []) {
  const onChange = vi.fn((_sections: DraftSection[]) => Promise.resolve())
  const view = render(
    <MemoryRouter>
      <DraftTree kind="resume" draft={draft} ownSections={ownSections} onChange={onChange} onFinish={onFinish} />
    </MemoryRouter>,
  )
  const rerender = (next: Draft) =>
    view.rerender(
      <MemoryRouter>
        <DraftTree kind="resume" draft={next} ownSections={ownSections} onChange={onChange} onFinish={onFinish} />
      </MemoryRouter>,
    )
  return { onChange, onFinish, rerender }
}

// Each row of a list: its name, badge (with "Source:" for screen readers), and Reject, as one line
// of text.
async function rows(list: string) {
  const ul = await screen.findByRole('list', { name: list })
  return [...ul.children].map((row) => row.querySelector(':scope > div')?.textContent)
}

function openRationale(name: string) {
  const toggle = screen.getByRole('button', { name: `Rationale for ${name}` })
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

const announced = () => document.querySelector('[aria-live="polite"]')?.textContent

// The sections the last change sent.
const sent = (onChange: { mock: { calls: [DraftSection[]][] } }) => onChange.mock.calls.at(-1)![0]

describe('DraftTree', () => {
  it('marks where each row came from, with Reject for what Claude brought in or wrote', async () => {
    stubLibrary()
    renderDraft()
    expect(screen.getByText('Loading your library…')).toBeInTheDocument()
    expect(await rows('Sections')).toEqual(['SummarySource: Original', 'ExperienceSource: Original', 'TalksSource: LibraryReject'])
    expect(screen.getByRole('link', { name: 'Tech Base Resume' })).toHaveAttribute('href', '/resumes/4')
    expect(screen.getByText(/It was made for a similar role\./)).toBeInTheDocument()
    // Claude's wording is what's shown; a rewording goes back to the original instead of a Reject.
    expect(await rows('Items in Summary')).toEqual([
      'Text: Builds accessible React apps.Source: Claude',
      'Text: Teaches web basics.Source: ClaudeReject',
    ])
    expect(await rows('Items in Experience')).toEqual(['Role: Engineer, AcmeSource: Original', 'Skills: Front EndSource: Original'])
    expect(await rows('Bullets under Engineer, Acme in Experience')).toEqual([
      'Led the React redesign.Source: Claude',
      'Cut load time in half.Source: LibraryReject',
    ])
    expect(await rows('Skills under Front End in Experience')).toEqual(['ReactSource: Original', 'CSSSource: LibraryReject'])
    expect(screen.getByText('Nothing here.')).toBeInTheDocument()
    // There's nothing to reorder or add here.
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^More options/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("opens Claude's reason, with the original beside a rewording and a way back", async () => {
    stubLibrary()
    const { onChange, rerender } = renderDraft()
    await screen.findByRole('list', { name: 'Sections' })
    openRationale('section "Summary"')
    expect(screen.getByText('The posting asks for a short summary.')).toBeInTheDocument()
    const name = 'Text: "Builds accessible React apps." in Summary'
    openRationale(name)
    expect(screen.getByText('Names React, which the posting asks for.')).toBeInTheDocument()
    expect(screen.getByText('Original', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Builds accessible apps.')).toBeInTheDocument()
    await expectNoA11yViolations()
    const button = screen.getByRole('button', { name: `Use the original wording of ${name}` })
    button.focus()
    fireEvent.click(button)
    await vi.waitFor(() => expect(announced()).toBe('Using the original wording.'))
    expect(sent(onChange)[0].entries[0]).toEqual({ ...DRAFT.sections[0].entries[0], use_original: true })

    // Saved, the original is shown and marked as such, and the same button offers Claude's
    // wording back, keeping focus.
    const next = structuredClone(DRAFT)
    next.sections[0].entries[0].use_original = true
    rerender(next)
    expect(await rows('Items in Summary')).toEqual(['Text: Builds accessible apps.Source: Original', 'Text: Teaches web basics.Source: ClaudeReject'])
    expect(screen.getByText("Claude's suggestion")).toBeInTheDocument()
    expect(screen.getByText('Builds accessible React apps.')).toBeInTheDocument()
    // Named for the wording now shown.
    const back = screen.getByRole('button', { name: `Use Claude's wording of Text: "Builds accessible apps." in Summary` })
    expect(back).toHaveTextContent("Use Claude's wording")
    expect(back).toHaveFocus()
    await expectNoA11yViolations()
  })

  it("shows only the reason for Claude's new text and for what it kept or brought in", async () => {
    stubLibrary()
    renderDraft()
    await screen.findByRole('list', { name: 'Sections' })
    openRationale('Text: "Teaches web basics." in Summary')
    openRationale('Role: Engineer, Acme in Experience')
    openRationale('"Cut load time in half." under Engineer, Acme in Experience')
    expect(screen.getByText('The posting mentions mentoring.')).toBeInTheDocument()
    expect(screen.getByText('Closest to this role.')).toBeInTheDocument()
    expect(screen.getByText('The posting asks about speed.')).toBeInTheDocument()
    expect(screen.queryByText('Original', { selector: 'p' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Use the original/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('rejects what Claude brought in or wrote, saying so and moving focus to its list', async () => {
    stubLibrary()
    const { onChange } = renderDraft()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject Text: "Teaches web basics." in Summary' }))
    await vi.waitFor(() => expect(announced()).toBe('Rejected Text: "Teaches web basics.".'))
    expect(sent(onChange)[0].entries).toEqual([DRAFT.sections[0].entries[0]])
    await vi.waitFor(() => expect(screen.getByRole('list', { name: 'Items in Summary' })).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: 'Reject "Cut load time in half." under Engineer, Acme in Experience' }))
    await vi.waitFor(() => expect(announced()).toBe('Rejected "Cut load time in half.".'))
    expect(sent(onChange)[1].entries[0].bullets).toEqual([DRAFT.sections[1].entries[0].bullets![0]])

    fireEvent.click(screen.getByRole('button', { name: 'Reject CSS under Front End in Experience' }))
    await vi.waitFor(() => expect(announced()).toBe('Rejected CSS.'))
    expect(sent(onChange)[1].entries[1].skill_ids).toEqual([1])
    await vi.waitFor(() => expect(screen.getByRole('list', { name: 'Skills under Front End in Experience' })).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: 'Reject section "Talks"' }))
    await vi.waitFor(() => expect(announced()).toBe('Rejected section "Talks".'))
    expect(sent(onChange).map((section) => section.section_id)).toEqual([1, 3])
    await vi.waitFor(() => expect(screen.getByRole('list', { name: 'Sections' })).toHaveFocus())
  })

  it('moves focus to the list above once the last row of a list is rejected', async () => {
    stubLibrary()
    const draft = structuredClone(DRAFT)
    draft.sections[1].entries[1].skill_ids = [3]
    renderDraft(draft)
    fireEvent.click(await screen.findByRole('button', { name: 'Reject CSS under Front End in Experience' }))
    await vi.waitFor(() => expect(screen.getByRole('list', { name: 'Items in Experience' })).toHaveFocus())
  })

  it('shows a change that fails, and says nothing', async () => {
    stubLibrary()
    const { onChange } = renderDraft()
    onChange.mockRejectedValueOnce(new ApiError('VALIDATION_FAILED', 'Something moved.', 'sections', 422))
    fireEvent.click(await screen.findByRole('button', { name: 'Reject section "Talks"' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something moved.')
    expect(announced()).toBe('')
    await expectNoA11yViolations()
  })

  it('says Claude started from the library when there was no earlier one, so all of it is from there', async () => {
    stubLibrary()
    renderDraft({ ...DRAFT, starting_document: null, starting_reason: 'There are no earlier resumes.' })
    expect(await screen.findByText('Claude started from your library. There are no earlier resumes.')).toBeInTheDocument()
    expect(await rows('Items in Experience')).toEqual(['Role: Engineer, AcmeSource: LibraryReject', 'Skills: Front EndSource: LibraryReject'])
  })

  it('starts from its own tree when it was read from the user’s file', async () => {
    stubLibrary()
    renderDraft({ ...DRAFT, starting_document: null, starting_reason: 'Your own resume.' }, undefined, START)
    expect(await screen.findByText('Claude started from your resume. Your own resume.')).toBeInTheDocument()
    expect(await rows('Items in Experience')).toEqual(['Role: Engineer, AcmeSource: Original', 'Skills: Front EndSource: Original'])
  })

  it('treats everything as from the library when the starting one was deleted', async () => {
    stubLibrary({ status: 404, body: errorBody('NOT_FOUND', 'Not found.') })
    renderDraft()
    expect(await rows('Items in Experience')).toEqual(['Role: Engineer, AcmeSource: LibraryReject', 'Skills: Front EndSource: LibraryReject'])
  })

  it('approves right away when Claude wrote nothing the draft leaves out', async () => {
    stubLibrary()
    const { onFinish } = renderDraft({ ...DRAFT, texts: [], sections: [{ section_id: 12, entries: [] }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Approve first draft' }))
    expect(onFinish).toHaveBeenCalledWith([])
    expect(await screen.findByRole('button', { name: 'Approving…' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("asks which of Claude's unused texts to keep, then approves", async () => {
    stubLibrary()
    const draft = structuredClone(DRAFT)
    // The rewording went back to the original, and the new text was rejected.
    draft.sections[0].entries = [{ ...draft.sections[0].entries[0], use_original: true }]
    const { onFinish } = renderDraft(draft)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve first draft' }))
    const dialog = screen.getByRole('dialog', { name: "Claude's text you didn't use" })
    const group = within(dialog).getByRole('group', { name: 'Keep in your library for later' })
    expect(within(group).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Builds accessible React apps.',
      'Teaches web basics.',
    ])
    await expectNoA11yViolations()
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Teaches web basics.' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve first draft' }))
    expect(onFinish).toHaveBeenCalledWith([2])
  })

  it('shows a refusal in the dialog, and cancels back to Approve first draft', async () => {
    stubLibrary()
    const draft = structuredClone(DRAFT)
    draft.sections[0].entries = [draft.sections[0].entries[0]]
    renderDraft(draft, vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'Something moved.', 'sections', 422))))
    const finish = await screen.findByRole('button', { name: 'Approve first draft' })
    fireEvent.click(finish)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve first draft' }))
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
      'GET /api/resumes/4': [{ status: 200, body: { sections: START } }],
    })
    renderDraft()
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await rows('Sections')).toEqual(['SummarySource: Original', 'ExperienceSource: Original', 'TalksSource: LibraryReject'])
  })

  it("marks a section Claude titled for a new paragraph as Claude's, and rejects it", async () => {
    stubLibrary()
    const draft: Draft = {
      ...DRAFT,
      texts: [...DRAFT.texts, { key: 4, kind: 'narrative', text: 'Acme ships every week.', replaces: null }],
      new_sections: [{ key: 1, title: 'why Acme' }],
      sections: [
        ...DRAFT.sections,
        {
          section_id: null,
          new_key: 1,
          reason: 'The posting says what Acme values.',
          entries: [{ kind: 'narrative', item_id: null, text_key: 4, reason: 'From the posting.' }],
        },
      ],
    }
    const { onChange } = renderDraft(draft)
    expect(await rows('Sections')).toEqual([
      'SummarySource: Original',
      'ExperienceSource: Original',
      'TalksSource: LibraryReject',
      'why AcmeSource: ClaudeReject',
    ])
    expect(await rows('Items in why Acme')).toEqual(['Text: Acme ships every week.Source: ClaudeReject'])
    openRationale('section "why Acme"')
    expect(screen.getByText('The posting says what Acme values.')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Reject section "why Acme"' }))
    await vi.waitFor(() => expect(announced()).toBe('Rejected section "why Acme".'))
    expect(sent(onChange)).toEqual(DRAFT.sections)
    await vi.waitFor(() => expect(screen.getByRole('list', { name: 'Sections' })).toHaveFocus())
  })
})

const GREETING: Greeting = { addressee: 'Jordan Rivera', reason: 'The posting names the hiring manager.', use_default: false }

describe('DraftGreeting', () => {
  function renderGreeting(greeting: Greeting = GREETING, usual: string | null = 'Acme Hiring Team') {
    const onChange = vi.fn((_useDefault: boolean) => Promise.resolve())
    const view = render(<DraftGreeting greeting={greeting} usual={usual} onChange={onChange} />)
    const rerender = (next: Greeting) => view.rerender(<DraftGreeting greeting={next} usual={usual} onChange={onChange} />)
    return { onChange, rerender }
  }

  it("shows Claude's greeting with its reason, and switches to the usual one and back", async () => {
    const { onChange, rerender } = renderGreeting()
    expect(await rows('Greeting')).toEqual(['Dear Jordan Rivera,Source: Claude'])
    openRationale('greeting')
    expect(screen.getByText('The posting names the hiring manager.')).toBeInTheDocument()
    expect(screen.getByText('Usual greeting')).toBeInTheDocument()
    expect(screen.getByText('Dear Acme Hiring Team,')).toBeInTheDocument()
    await expectNoA11yViolations()
    const button = screen.getByRole('button', { name: 'Use the usual greeting' })
    button.focus()
    fireEvent.click(button)
    expect(onChange).toHaveBeenCalledWith(true)
    await vi.waitFor(() => expect(announced()).toBe('Using the usual greeting.'))

    // Saved, the usual one shows with no badge, and the same button offers Claude's back.
    rerender({ ...GREETING, use_default: true })
    expect(await rows('Greeting')).toEqual(['Dear Acme Hiring Team,'])
    expect(screen.getByText("Claude's suggestion")).toBeInTheDocument()
    expect(screen.getByText('Dear Jordan Rivera,')).toBeInTheDocument()
    const back = screen.getByRole('button', { name: "Use Claude's greeting" })
    expect(back).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.click(back)
    expect(onChange).toHaveBeenLastCalledWith(false)
    await vi.waitFor(() => expect(announced()).toBe("Using Claude's greeting."))
  })

  it('says when the letter has no usual greeting', async () => {
    renderGreeting({ ...GREETING, use_default: true }, null)
    expect(await rows('Greeting')).toEqual(['No greeting.'])
  })

  it('shows a change that fails, and says nothing', async () => {
    const { onChange } = renderGreeting()
    onChange.mockRejectedValueOnce(new ApiError('VALIDATION_FAILED', 'Something moved.', 'sections', 422))
    openRationale('greeting')
    fireEvent.click(screen.getByRole('button', { name: 'Use the usual greeting' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something moved.')
    expect(announced()).toBe('')
    await expectNoA11yViolations()
  })
})
