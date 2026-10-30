import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DocDetail } from '../api/documents'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import DocumentTree from './DocumentTree'

const empty = { skill_categories: [], experience: [], projects: [], bullets: [], education: [], used_by: [] }
const SECTIONS = [
  {
    id: 1,
    title: 'Summary',
    built_in: true,
    ...empty,
    narrative_content: [{ content_id: 6, content: 'Builds accessible apps.' }],
  },
  {
    id: 3,
    title: 'Experience',
    built_in: true,
    narrative_content: [],
    ...empty,
    experience: [{ experience_id: 7, role_title: 'Engineer', organization: 'Acme', dates: null }],
  },
  { id: 12, title: 'Talks', built_in: false, narrative_content: [], ...empty },
]
const LEAD = { bullet_id: 8, content: 'Led the redesign.' }
const CUT = { bullet_id: 9, content: 'Cut load time in half.' }
const LIBRARY: Record<string, unknown[]> = {
  sections: SECTIONS,
  'narrative-content': [
    { content_id: 5, content: 'Engineer with 4 years.', sections: [], used_by: [] },
    { content_id: 6, content: 'Builds accessible apps.', sections: [], used_by: [] },
  ],
  'skill-categories': [
    {
      category_id: 2,
      category_name: 'Front End',
      built_in: false,
      skills: [
        { skill_id: 1, skill_name: 'React' },
        { skill_id: 3, skill_name: 'CSS' },
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

const DOC: DocDetail = {
  id: 1,
  name: 'Tech base',
  header_id: null,
  tone_set_id: null,
  job_posting: null,
  based_on: null,
  locked: false,
  copies: [],
  updated_at: null,
  output: { parts: [], text: '' },
  sections: [
    {
      row_id: 100,
      section_id: 1,
      title: 'Summary',
      entries: [
        {
          kind: 'narrative',
          row_id: 200,
          item_id: 5,
          position: 1,
          values: { content: 'Engineer with 4 years.' },
          skills: [],
          bullets: [],
        },
      ],
    },
    {
      row_id: 101,
      section_id: 3,
      title: 'Experience',
      entries: [
        {
          kind: 'experience',
          row_id: 300,
          item_id: 7,
          position: 1,
          values: { role_title: 'Engineer', organization: 'Acme', location: null, dates: null },
          skills: [],
          bullets: [{ row_id: 400, item_id: 8, position: 1, text: 'Led the redesign.' }],
        },
        {
          kind: 'category',
          row_id: 301,
          item_id: 2,
          position: 2,
          values: { category_name: 'Front End' },
          skills: [{ row_id: 401, item_id: 1, position: 1, text: 'React' }],
          bullets: [],
        },
      ],
    },
  ],
}

// The library lists, answered `times` times each (it's read again after writing something new).
function libraryReplies(times = 1): Record<string, Reply[]> {
  return Object.fromEntries(
    Object.entries(LIBRARY).map(([path, body]) => [
      `GET /api/${path}`,
      Array.from({ length: times }, () => ({ status: 200, body })),
    ]),
  )
}

function stub(extra: Record<string, Reply[]> = {}, times = 1) {
  return stubApi({ ...libraryReplies(times), ...extra })
}

// Opens a list's "More options", checks these, and adds them.
async function addTo(list: string, ...names: string[]) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^More options for ${list} \\(`) }))
  for (const name of names) fireEvent.click(screen.getByRole('checkbox', { name }))
  fireEvent.click(screen.getByRole('button', { name: `Add checked to ${list}` }))
}

// The names of the items in a list, in order.
async function rowNames(list: string) {
  const group = await screen.findByRole('group', { name: list })
  return within(group)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.item-name')?.textContent)
}

function renderTree(doc: DocDetail = DOC, readOnly = false) {
  const props = { onChange: vi.fn(), onNotice: vi.fn() }
  render(<DocumentTree kind="resume" doc={doc} readOnly={readOnly} {...props} />)
  return props
}

const saved = { ...DOC, resume_id: 1, name: 'Tech base' }

// Opens a row to show what's under it.
async function expand(name: string) {
  const toggle = await screen.findByRole('button', { name })
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

// Opens the Experience section and the role and category in it.
async function openExperience() {
  await expand('Experience')
  await expand('Role: Engineer, Acme')
  await expand('Skills: Front End')
}

describe('DocumentTree', () => {
  it('opens each level in turn: sections, their items, then skills and bullets', async () => {
    stub()
    renderTree()
    expect(await rowNames('Sections')).toEqual(['Summary', 'Experience'])
    // Every level starts closed.
    expect(screen.queryByRole('group', { name: 'Items in Experience' })).not.toBeInTheDocument()
    await expectNoA11yViolations()
    await expand('Experience')
    expect(await rowNames('Items in Experience')).toEqual(['Role: Engineer, Acme', 'Skills: Front End'])
    expect(screen.queryByRole('group', { name: 'Engineer, Acme bullets' })).not.toBeInTheDocument()
    await expand('Role: Engineer, Acme')
    await expand('Skills: Front End')
    expect(await rowNames('Engineer, Acme bullets')).toEqual(['Led the redesign.'])
    // What else each list could show waits under "More options".
    expect(screen.getByRole('button', { name: 'More options for Front End skills (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More options for Engineer, Acme bullets (1)' })).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Experience' }))
    expect(screen.queryByRole('group', { name: 'Items in Experience' })).not.toBeInTheDocument()
  })

  it('opens a role to its fields, and starts adding content with the type the section lists', async () => {
    stub()
    renderTree()
    await openExperience()
    const fields = screen.getAllByRole('definition').map((field) => field.textContent)
    expect(fields).toEqual(['Engineer', 'Acme', 'None', 'None'])
    fireEvent.click(screen.getByRole('button', { name: 'Add content to Experience' }))
    expect(screen.getByLabelText('Type of content')).toHaveValue('experience')
    await expectNoA11yViolations()
  })

  it('adds a section and sends the whole list', async () => {
    const fetchMock = stub({ 'PUT /api/resumes/1/sections': [{ status: 200, body: saved }] })
    const { onChange } = renderTree()
    await addTo('Sections', 'Talks')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(sentBody(fetchMock, 'PUT /api/resumes/1/sections')).toEqual({ section_ids: [1, 3, 12] })
    expect(onChange.mock.calls[0][0].id).toBe(1)
  })

  it('adds a saved item of any kind to a section', async () => {
    const fetchMock = stub({ 'POST /api/resumes/1/sections/100/items': [{ status: 201, body: saved }] })
    const { onChange } = renderTree()
    await expand('Summary')
    fireEvent.click(screen.getByRole('button', { name: 'Add content to Summary' }))
    fireEvent.change(screen.getByLabelText('Type of content'), { target: { value: 'bullet' } })
    fireEvent.change(screen.getByLabelText('Bullet'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Summary' }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    // Without skills or bullets, so it comes with its defaults.
    expect(sentBody(fetchMock, 'POST /api/resumes/1/sections/100/items')).toEqual({
      items: [{ kind: 'bullet', item_id: 9 }],
    })
  })

  it("adds any of what the section lists from its More options, each with its defaults", async () => {
    const fetchMock = stub({ 'POST /api/resumes/1/sections/100/items': [{ status: 201, body: saved }] })
    const { onChange } = renderTree()
    await expand('Summary')
    fireEvent.click(screen.getByRole('button', { name: 'More options for Items in Summary (1)' }))
    // Under a heading for its type, leaving out what's already placed.
    const narrative = screen.getByRole('group', { name: 'Narrative content' })
    expect(within(narrative).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Text: Builds accessible apps.',
    ])
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Text: Builds accessible apps.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add checked to Items in Summary' }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(sentBody(fetchMock, 'POST /api/resumes/1/sections/100/items')).toEqual({
      items: [{ kind: 'narrative', item_id: 6 }],
    })
    // Nothing more to add, so focus goes to the list, and the list says what happened.
    await vi.waitFor(() => expect(screen.getByRole('group', { name: 'Items in Summary' })).toHaveFocus())
    expect(screen.getByText('Added 1 to Items in Summary.')).toBeInTheDocument()
  })

  it("removes an item, and changes a category's skills and a role's bullets", async () => {
    const fetchMock = stub({
      'PUT /api/resumes/1/sections/101/items': [{ status: 200, body: saved }],
      'PUT /api/resumes/1/items/category/301/skills': [{ status: 200, body: saved }],
      'PUT /api/resumes/1/items/experience/300/bullets': [{ status: 200, body: saved }],
    })
    renderTree()
    await openExperience()
    await addTo('Front End skills', 'CSS')
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'PUT /api/resumes/1/items/category/301/skills')).toEqual({ skill_ids: [1, 3] }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Led the redesign."' }))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'PUT /api/resumes/1/items/experience/300/bullets')).toEqual({ bullet_ids: [] }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Skills: Front End' }))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'PUT /api/resumes/1/sections/101/items')).toEqual({
        entries: [{ kind: 'experience', item_id: 7 }],
      }),
    )
  })

  it('shows why a change was refused', async () => {
    stub({
      'PUT /api/resumes/1/items/experience/300/bullets': [
        {
          status: 409,
          body: errorBody('DUPLICATE', '"Cut load time in half." is already in this section.', 'bullet_ids'),
        },
      ],
    })
    renderTree()
    await openExperience()
    await addTo('Engineer, Acme bullets', 'Cut load time in half.')
    expect(await screen.findByRole('alert')).toHaveTextContent('is already in this section.')
    await expectNoA11yViolations()
  })

  it('writes a new bullet under a role and reads the library again', async () => {
    const fetchMock = stub({ 'POST /api/resumes/1/items/experience/300/written': [{ status: 201, body: saved }] }, 2)
    const { onChange, onNotice } = renderTree()
    await openExperience()
    // "New bullet" on the button; its name says for what, and so does the field's label.
    const write = screen.getByRole('button', { name: 'New bullet for Engineer, Acme' })
    expect(write).toHaveTextContent(/^New bullet$/)
    fireEvent.click(write)
    const field = screen.getByLabelText('New bullet for Engineer, Acme')
    expect(field).toHaveFocus()
    fireEvent.change(field, { target: { value: 'Shipped the new checkout.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bullet' }))
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith("Added the new bullet. It's saved in your library too."))
    expect(sentBody(fetchMock, 'POST /api/resumes/1/items/experience/300/written')).toEqual({
      content: 'Shipped the new checkout.',
    })
    expect(onChange).toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/experience')).toHaveLength(2),
    )
  })

  it("saves a new version of a role's bullet only when its text changed", async () => {
    const fetchMock = stub({ 'POST /api/resumes/1/items/experience/300/written': [{ status: 201, body: saved }] }, 2)
    const { onNotice } = renderTree()
    await openExperience()
    const button = () => screen.getByRole('button', { name: 'New version of "Led the redesign."' })
    expect(button()).toHaveTextContent(/^New version$/)
    fireEvent.click(button())
    // Starts from the bullet's text, under its row.
    const field = screen.getByLabelText('New version')
    expect(field).toHaveFocus()
    expect(field).toHaveValue('Led the redesign.')
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: ' Led the redesign. ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith('The text is unchanged, so nothing was saved.'))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    await vi.waitFor(() => expect(button()).toHaveFocus())

    fireEvent.click(button())
    fireEvent.change(screen.getByLabelText('New version'), { target: { value: 'Led the checkout redesign.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))
    await vi.waitFor(() =>
      expect(onNotice).toHaveBeenLastCalledWith('Saved the new version. The original is still in your library.'),
    )
    expect(sentBody(fetchMock, 'POST /api/resumes/1/items/experience/300/written')).toEqual({
      content: 'Led the checkout redesign.',
      replaces: 8,
    })
  })

  it('saves a new version of narrative content in a section, and cancels back to its button', async () => {
    const fetchMock = stub({ 'POST /api/resumes/1/sections/100/written': [{ status: 201, body: saved }] }, 2)
    renderTree()
    await expand('Summary')
    const button = () => screen.getByRole('button', { name: 'New version of Text: "Engineer with 4 years."' })
    fireEvent.click(button())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(button()).toHaveFocus())
    fireEvent.click(button())
    fireEvent.change(screen.getByLabelText('New version'), { target: { value: 'Engineer with 5 years.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'POST /api/resumes/1/sections/100/written')).toEqual({
        kind: 'narrative',
        content: 'Engineer with 5 years.',
        replaces: 5,
      }),
    )
    // A role isn't text, so it has no new version.
    await expand('Experience')
    expect(screen.queryByRole('button', { name: /^New version of Role/ })).not.toBeInTheDocument()
  })

  it("writes a new skill under a category, in one line", async () => {
    const fetchMock = stub(
      { 'POST /api/resumes/1/items/category/301/skills/written': [{ status: 201, body: saved }] },
      2,
    )
    const { onNotice } = renderTree()
    await openExperience()
    const write = screen.getByRole('button', { name: 'New skill for Front End' })
    expect(write).toHaveTextContent(/^New skill$/)
    fireEvent.click(write)
    const field = screen.getByLabelText('New skill for Front End')
    expect(field.tagName).toBe('INPUT')
    expect(field).toHaveFocus()
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Vite' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }))
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith("Added the new skill. It's saved in your library too."))
    expect(sentBody(fetchMock, 'POST /api/resumes/1/items/category/301/skills/written')).toEqual({ skill_name: 'Vite' })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'New skill for Front End' })).toHaveFocus())
  })

  it('writes new narrative content in a section, with focus going in and back', async () => {
    const fetchMock = stub({ 'POST /api/resumes/1/sections/100/written': [{ status: 201, body: saved }] }, 2)
    const { onNotice } = renderTree()
    await expand('Summary')
    fireEvent.click(screen.getByRole('button', { name: 'Add content to Summary' }))
    await vi.waitFor(() => expect(screen.getByLabelText('Type of content')).toHaveFocus())
    // Summary lists narrative content, so that's the type it starts with.
    fireEvent.change(screen.getByLabelText('Narrative content'), { target: { value: 'new' } })
    fireEvent.change(screen.getByLabelText('Text (required)'), { target: { value: 'Open to remote work.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Summary' }))
    await vi.waitFor(() =>
      expect(onNotice).toHaveBeenCalledWith("Added the new narrative content. It's saved in your library too."),
    )
    expect(sentBody(fetchMock, 'POST /api/resumes/1/sections/100/written')).toEqual({
      kind: 'narrative',
      content: 'Open to remote work.',
    })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Add content to Summary' })).toHaveFocus())
  })

  it('only shows the tree when read-only, without reading the library', async () => {
    const fetchMock = stubApi({})
    renderTree(DOC, true)
    await expand('Experience')
    await expand('Role: Engineer, Acme')
    expect(await rowNames('Engineer, Acme bullets')).toEqual(['Led the redesign.'])
    expect(screen.queryByRole('button', { name: /^Move|^Remove|^New|^Add/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    await expectNoA11yViolations()
  })

  it('starts with no sections', async () => {
    stub()
    renderTree({ ...DOC, sections: [] })
    expect(await screen.findByText('No sections yet. Add one to start.')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('says it is loading the library', async () => {
    stubPendingApi()
    renderTree()
    expect(screen.getByText('Loading your library…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the library fails to load', async () => {
    stubApi({
      ...libraryReplies(2),
      'GET /api/sections': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: SECTIONS },
      ],
    })
    renderTree()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('group', { name: 'Sections' })).toBeInTheDocument()
  })
})
