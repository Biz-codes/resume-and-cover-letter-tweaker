import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DocDetail } from '../../shared/api/documents'
import { expectNoA11yViolations } from '../../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../../test/stubApi'
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
  hidden: false,
  copies: [],
  updated_at: null,
  output: { parts: [], text: '' },
  draft: null,
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
  const props = { onChange: vi.fn(), onReload: vi.fn(), onNotice: vi.fn() }
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

// Opens the Experience section, the role and category in it, and the role's bullets.
async function openExperience() {
  await expand('Experience')
  await expand('Role: Engineer, Acme in Experience')
  await expand('Skills: Front End in Experience')
  await expand('Bullets for Engineer, Acme (1)')
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
    await expand('Role: Engineer, Acme in Experience')
    // A role has more than one part, so each opens on its own, named for the role, and starts
    // closed; a category has only its skills, shown right away.
    const details = screen.getByRole('button', { name: 'Details for Engineer, Acme' })
    const bulletsToggle = screen.getByRole('button', { name: 'Bullets for Engineer, Acme (1)' })
    expect(details).toHaveAttribute('aria-expanded', 'false')
    expect(bulletsToggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(bulletsToggle).getByText('for Engineer, Acme')).toHaveClass('visually-hidden')
    expect(screen.queryByRole('group', { name: 'Engineer, Acme bullets' })).not.toBeInTheDocument()
    await expectNoA11yViolations()
    await expand('Skills: Front End in Experience')
    expect(screen.getByRole('group', { name: 'Front End skills' })).toBeInTheDocument()
    await expand('Bullets for Engineer, Acme (1)')
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
    await expand('Details for Engineer, Acme')
    const fields = screen.getAllByRole('definition').map((field) => field.textContent)
    expect(fields).toEqual(['Engineer', 'Acme', 'None', 'None'])
    // Add content is inside the section's More options.
    expect(screen.queryByRole('button', { name: 'Add content to Experience' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^More options for Items in Experience/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add content to Experience' }))
    expect(screen.getByLabelText('Type of content')).toHaveValue('experience')
    await expectNoA11yViolations()
  })

  it('opens an empty section to its Add content form, even with no more options', async () => {
    stub()
    renderTree({ ...DOC, sections: [{ row_id: 102, section_id: 12, title: 'Talks', entries: [] }] })
    await expand('Talks')
    // Talks lists nothing, so there's no count, but Add content is still inside, open.
    const more = screen.getByRole('button', { name: 'More options for Items in Talks' })
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByLabelText('Type of content')).toBeInTheDocument()
    expect(screen.queryByText(/No more options/)).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('writes a new section from its title, inside More options for Sections', async () => {
    const fetchMock = stub({ 'POST /api/resumes/1/sections/written': [{ status: 201, body: saved }] }, 2)
    const { onChange, onNotice } = renderTree()
    fireEvent.click(await screen.findByRole('button', { name: /^More options for Sections/ }))
    fireEvent.click(screen.getByRole('button', { name: 'New section title' }))
    const field = screen.getByLabelText('New section title')
    await vi.waitFor(() => expect(field).toHaveFocus())
    await expectNoA11yViolations()
    fireEvent.change(field, { target: { value: 'Volunteering' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith('Added the new section "Volunteering".'))
    expect(onChange).toHaveBeenCalled()
    expect(sentBody(fetchMock, 'POST /api/resumes/1/sections/written')).toEqual({ title: 'Volunteering' })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'New section title' })).toHaveFocus())
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
    const { onChange, onNotice } = renderTree()
    await expand('Summary')
    fireEvent.click(screen.getByRole('button', { name: 'More options for Items in Summary (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add content to Summary' }))
    fireEvent.change(screen.getByLabelText('Type of content'), { target: { value: 'bullet' } })
    fireEvent.change(screen.getByLabelText('Bullet'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Summary' }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith('Added the bullet to Summary.'))
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
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Led the redesign." under Engineer, Acme in Experience' }))
    await vi.waitFor(() =>
      expect(sentBody(fetchMock, 'PUT /api/resumes/1/items/experience/300/bullets')).toEqual({ bullet_ids: [] }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Skills: Front End in Experience' }))
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

  it("saves a change to the library item from its dialog, reads the document again, and returns to the row", async () => {
    const edited = { ...LIBRARY['bullet-points'][0] as object, content: 'Led the whole redesign.' }
    const fetchMock = stub(
      {
        'PUT /api/bullet-points/8': [{ status: 200, body: edited }],
        'GET /api/resumes/1': [{ status: 200, body: saved }],
      },
      2,
    )
    const { onChange, onReload, onNotice } = renderTree()
    await openExperience()
    const button = screen.getByRole('button', { name: 'View and Edit "Led the redesign." under Engineer, Acme in Experience' })
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog', { name: 'Led the redesign.' })
    // Nothing else uses it, so saving changes it here only. There's no New version.
    expect(within(dialog).getByLabelText('Bullet text')).toHaveAccessibleDescription('Saving changes it in your library and in this resume.')
    expect(within(dialog).queryByRole('button', { name: /New version/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.change(within(dialog).getByLabelText('Bullet text'), { target: { value: 'Led the whole redesign.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(onNotice).toHaveBeenLastCalledWith('Saved.'))
    expect(sentBody(fetchMock, 'PUT /api/bullet-points/8')).toEqual({ content: 'Led the whole redesign.', apply_to: [] })
    // Read again without counting as a change here to undo.
    expect(onReload).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(onChange).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(button).toHaveFocus())
  })

  it('applies a role’s edit to this resume, and asks only about the others in progress', async () => {
    const here = { kind: 'resume' as const, id: 1, name: 'Tech base', locked: false }
    const other = { kind: 'resume' as const, id: 4, name: 'Teaching base', locked: false }
    const role = { ...(LIBRARY.experience[0] as object), used_by: [here, other] }
    const fetchMock = stub(
      {
        'GET /api/experience': [1, 2, 3].map(() => ({ status: 200, body: [role] })),
        'PUT /api/experience/7': [{ status: 200, body: { ...role, experience_id: 9, dates: '2021', used_by: [here] } }],
        'GET /api/resumes/1': [{ status: 200, body: saved }],
      },
      2,
    )
    const { onNotice } = renderTree()
    await expand('Experience')
    fireEvent.click(screen.getByRole('button', { name: 'View and Edit Role: Engineer, Acme in Experience' }))
    const dialog = await screen.findByRole('dialog', { name: 'Engineer, Acme' })
    const choice = within(dialog).getByRole('group', { name: 'Apply this change to which other resumes and cover letters in progress?' })
    expect(within(choice).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual(['Resume: Teaching base'])
    await expectNoA11yViolations()
    fireEvent.change(within(dialog).getByLabelText(/Dates/), { target: { value: '2021' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(onNotice).toHaveBeenLastCalledWith(
        'Saved as a new version, "Engineer, Acme (2021)", which this resume uses now. Everything else keeps "Engineer, Acme".',
      ),
    )
    expect(sentBody(fetchMock, 'PUT /api/experience/7')).toMatchObject({ dates: '2021', apply_to: [{ kind: 'resume', id: 1 }] })
  })

  it('says an item shown from a name inside the dialog changes as from the library', async () => {
    stub({}, 2)
    renderTree()
    await expand('Experience')
    fireEvent.click(screen.getByRole('button', { name: 'View and Edit Role: Engineer, Acme in Experience' }))
    const dialog = await screen.findByRole('dialog', { name: 'Engineer, Acme' })
    expect(within(dialog).getByLabelText('Title (required)')).toHaveAccessibleDescription('Saving changes it in your library and in this resume.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Led the redesign.' }))
    await screen.findByRole('dialog', { name: 'Led the redesign.' })
    // Nothing uses it, and it isn't the row that was opened, so there's no note about this resume.
    expect(within(dialog).getByLabelText('Bullet text')).not.toHaveAccessibleDescription()
  })

  it('renames a section from its row for this resume, keeping the dialog open with the reason when refused', async () => {
    const fetchMock = stub(
      {
        'PUT /api/sections/3': [
          { status: 409, body: errorBody('DUPLICATE', 'A section named "Talks" already exists.', 'title') },
        ],
      },
      2,
    )
    const { onChange, onNotice } = renderTree()
    fireEvent.click(await screen.findByRole('button', { name: 'View and Edit Experience' }))
    const dialog = await screen.findByRole('dialog', { name: 'Experience' })
    const field = within(dialog).getByLabelText('Section title')
    expect(field).toHaveAccessibleDescription('Built-in sections keep their title, so saving adds a new section. The new one goes in your library, used in this resume only.')
    fireEvent.change(field, { target: { value: 'Talks' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('A section named "Talks" already exists.')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(sentBody(fetchMock, 'PUT /api/sections/3')).toEqual({ title: 'Talks', apply_to: [] })
    expect(screen.getByRole('dialog', { name: 'Experience' })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(onNotice).not.toHaveBeenCalledWith(expect.stringMatching(/^Saved/))
    await expectNoA11yViolations()
  })

  it('names each row’s buttons for its place, so the same item in two sections reads differently', async () => {
    stub()
    const role = DOC.sections[1].entries[0]
    renderTree({
      ...DOC,
      sections: [...DOC.sections, { row_id: 102, section_id: 12, title: 'Talks', entries: [{ ...role, row_id: 302 }] }],
    })
    await expand('Experience')
    await expand('Talks')
    expect(screen.getByRole('button', { name: 'View and Edit Role: Engineer, Acme in Experience' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View and Edit Role: Engineer, Acme in Talks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Role: Engineer, Acme in Talks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Role: Engineer, Acme in Talks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Role: Engineer, Acme in Talks' })).toHaveAttribute('aria-expanded', 'false')
    for (const start of [/^View and Edit/, /^Move /, /^Remove /, /^Role: /]) {
      const names = screen.getAllByRole('button', { name: start }).map((button) => button.getAttribute('aria-label'))
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it("deletes a row's library item from its dialog, reads the document again, and moves focus to the page heading", async () => {
    stub(
      {
        'DELETE /api/bullet-points/8': [{ status: 204 }],
        'GET /api/resumes/1': [{ status: 200, body: saved }],
      },
      2,
    )
    const props = { onChange: vi.fn(), onReload: vi.fn(), onNotice: vi.fn() }
    render(
      <>
        <h2 id="page-heading" tabIndex={-1}>
          Tech base Resume
        </h2>
        <DocumentTree kind="resume" doc={DOC} readOnly={false} {...props} />
      </>,
    )
    await openExperience()
    fireEvent.click(screen.getByRole('button', { name: 'View and Edit "Led the redesign." under Engineer, Acme in Experience' }))
    const dialog = await screen.findByRole('dialog', { name: 'Led the redesign.' })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete "/ }))
    const confirm = within(dialog).getByRole('group', { name: /^Delete/ })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(props.onNotice).toHaveBeenLastCalledWith('Deleted "Led the redesign.".'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(props.onReload).toHaveBeenCalled()
    expect(props.onChange).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Tech base Resume' })).toHaveFocus())
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
    fireEvent.click(screen.getByRole('button', { name: 'More options for Items in Summary (1)' }))
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
    await expand('Role: Engineer, Acme in Experience')
    await expand('Bullets for Engineer, Acme (1)')
    expect(await rowNames('Engineer, Acme bullets')).toEqual(['Led the redesign.'])
    expect(screen.queryByRole('button', { name: /^Move|^Remove|^New|^Add|^View and Edit/ })).not.toBeInTheDocument()
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
  it("offers a project every skill in the library, listing a new one under the project", async () => {
    const portfolio = {
      project_id: 4,
      project_title: 'Portfolio',
      done_for: null,
      url: null,
      dates: null,
      skills: [{ skill_id: 1, skill_name: 'React' }],
      bullets: [],
      sections: [],
      used_by: [],
    }
    const project = {
      kind: 'project' as const,
      row_id: 302,
      item_id: 4,
      position: 1,
      values: { project_title: 'Portfolio', done_for: null, url: null, dates: null },
      skills: [{ row_id: 402, item_id: 1, position: 1, text: 'React' }],
      bullets: [],
    }
    const doc = { ...DOC, sections: [{ row_id: 102, section_id: 4, title: 'Projects', entries: [project] }] }
    const library = { ...libraryReplies(2), 'GET /api/projects': [{ status: 200, body: [portfolio] }, { status: 200, body: [portfolio] }] }
    const fetchMock = stubApi({
      ...library,
      'PUT /api/resumes/1/items/project/302/skills': [{ status: 200, body: doc }],
    })
    renderTree(doc)
    await expand('Projects')
    await expand('Project: Portfolio in Projects')
    await expand('Skills for Portfolio (1)')
    fireEvent.click(await screen.findByRole('button', { name: /^More options for Portfolio skills \(/ }))
    // Its own skills come first; the rest of the library after, saying what adding one does.
    expect(screen.getByRole('group', { name: 'Other skills in your library (adding one lists it under Portfolio too)' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Other skills in your library (adding one lists it under Portfolio too)' })).getByRole('checkbox', { name: 'CSS' })).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('checkbox', { name: 'CSS' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add checked to Portfolio skills' }))
    await vi.waitFor(() => expect(sentBody(fetchMock, 'PUT /api/resumes/1/items/project/302/skills')).toEqual({ skill_ids: [1, 3] }))
    // CSS is listed under the project now, so the library is read again.
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects')).toHaveLength(2),
    )
  })
  it('offers a category every skill in the library, listing a new one under the category', async () => {
    const categories = [
      ...LIBRARY['skill-categories'],
      { category_id: 5, category_name: 'Tools', built_in: false, skills: [{ skill_id: 6, skill_name: 'Git' }], sections: [], used_by: [] },
    ]
    const fetchMock = stubApi({
      ...libraryReplies(2),
      'GET /api/skill-categories': [{ status: 200, body: categories }, { status: 200, body: categories }],
      'PUT /api/resumes/1/items/category/301/skills': [{ status: 200, body: DOC }],
    })
    renderTree()
    await expand('Experience')
    await expand('Skills: Front End in Experience')
    fireEvent.click(await screen.findByRole('button', { name: /^More options for Front End skills \(/ }))
    expect(within(screen.getByRole('group', { name: 'Listed under Front End' })).getByRole('checkbox', { name: 'CSS' })).toBeInTheDocument()
    const others = screen.getByRole('group', { name: 'Other skills in your library (adding one lists it under Front End too)' })
    await expectNoA11yViolations()
    fireEvent.click(within(others).getByRole('checkbox', { name: 'Git' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add checked to Front End skills' }))
    await vi.waitFor(() => expect(sentBody(fetchMock, 'PUT /api/resumes/1/items/category/301/skills')).toEqual({ skill_ids: [1, 6] }))
    // Git is listed under Front End now, so the library is read again.
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/skill-categories')).toHaveLength(2),
    )
  })
})
