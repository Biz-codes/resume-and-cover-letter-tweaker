import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Header } from '../../shared/api/headers'
import { expectNoA11yViolations } from '../../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../../test/stubApi'
import DocumentRoute from './DocumentPage'
import DocumentsPage from '../DocumentsPage'
import { expectNotice } from '../../test/notice'

const SAM: Header = {
  hidden: false,
  header_id: 1,
  created_at: '2026-10-01T09:00:00',
  full_name: 'Sam Rivera',
  headline: 'Engineer',
  email: 'sam@example.com',
  phone: null,
  location: null,
  linkedin_url: null,
  github_url: null,
  portfolio_url: null,
  used_by: [],
}
const TECH_TONE = { tone_set_id: 2, name: 'Tech', rules: [], used_by: [] }
const OUTPUT = {
  parts: [
    { label: 'Header', text: 'Sam Rivera\nEngineer\nsam@example.com' },
    { label: 'Experience', text: 'Experience\nEngineer | Acme\n- Led the redesign.' },
    { label: 'Volunteering', text: '' },
  ],
  text: 'Sam Rivera\nEngineer\nsam@example.com\n\nExperience\nEngineer | Acme\n- Led the redesign.',
}

// Each test uses its own resume id: the warning before editing a base version is only shown
// once per version while the app is open.
function resume(id: number, values: object = {}) {
  return {
    resume_id: id,
    name: 'Tech base',
    header_id: 1,
    tone_set_id: null,
    job_posting: null,
    based_on: null,
    locked: false,
    copies: [],
    updated_at: null,
    sections: [],
    output: OUTPUT,
    ...values,
  }
}

const SENT = {
  name: 'Acme resume',
  job_posting: { job_posting_id: 4, organization: 'Acme', role_title: 'Engineer' },
  based_on: { id: 1, name: 'Tech base' },
  locked: true,
  copies: [{ kind: 'resume', id: 9, name: 'Acme copy', locked: false }],
}

function stub(id: number, doc: object, extra: Record<string, Reply[]> = {}) {
  return stubApi({
    [`GET /api/resumes/${id}`]: [{ status: 200, body: doc }],
    'GET /api/headers': [{ status: 200, body: [SAM] }],
    'GET /api/tone-sets': [{ status: 200, body: [TECH_TONE] }],
    ...extra,
  })
}

// Opens the preview, which starts closed, once the page has loaded.
async function openPreview() {
  fireEvent.click(await screen.findByRole('button', { name: 'Preview and copy' }))
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/resumes" element={<DocumentsPage kind="resume" />} />
        <Route path="/resumes/:id" element={<DocumentRoute kind="resume" />} />
        <Route path="/cover-letters/:id" element={<DocumentRoute kind="cover_letter" />} />
      </Routes>
    </MemoryRouter>,
  )
}

// jsdom has no clipboard. Each test that copies defines its own.
function stubClipboard(writeText = vi.fn(() => Promise.resolve())) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

describe('DocumentPage', () => {
  it('shows the tone, a tree that opens level by level, and the preview in parts', async () => {
    stub(1, resume(1, { tone_set_id: 2 }))
    renderAt('/resumes/1')
    expect(await screen.findByRole('heading', { level: 2, name: 'Tech base Resume' })).toBeInTheDocument()
    await vi.waitFor(() => expect(document.title).toBe('Tech base Resume – Resume Tweaker'))
    expect(screen.getByText('Base resume')).toBeInTheDocument()
    expect(screen.getByText('Tone: Tech')).toBeInTheDocument()
    const header = screen.getByRole('button', { name: 'Header' })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Sections (0)' })).toBeInTheDocument()
    fireEvent.click(header)
    expect(screen.getByText('sam@example.com')).toBeInTheDocument()
    // The preview is one closed level too, its button in a heading so it's found by heading.
    const preview = screen.getByRole('button', { name: 'Preview and copy' })
    expect(screen.getByRole('heading', { level: 3, name: 'Preview and copy' })).toContainElement(preview)
    expect(preview).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('heading', { level: 4, name: 'Experience' })).not.toBeInTheDocument()
    fireEvent.click(preview)
    expect(screen.getByRole('heading', { level: 4, name: 'Experience' })).toBeInTheDocument()
    expect(screen.getByText('Empty.')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('copies the whole document or one part', async () => {
    stub(2, resume(2))
    const writeText = stubClipboard()
    renderAt('/resumes/2')
    await openPreview()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy the whole resume' }))
    await expectNotice('Copied the whole resume.')
    expect(writeText).toHaveBeenCalledWith(OUTPUT.text)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Experience' }))
    expect(await screen.findByText('Copied Experience.')).toBeInTheDocument()
    expect(writeText).toHaveBeenLastCalledWith(OUTPUT.parts[1].text)
  })

  it('says when copying fails', async () => {
    stub(3, resume(3))
    stubClipboard(vi.fn(() => Promise.reject(new Error('denied'))))
    renderAt('/resumes/3')
    await openPreview()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy Header' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't copy.")
    await expectNoA11yViolations()
  })

  it('shows a base version read-only until the user chooses to edit it in place', async () => {
    const saved = resume(4, { tone_set_id: 2 })
    const fetchMock = stub(4, resume(4), { 'PUT /api/resumes/4': [{ status: 200, body: saved }] })
    renderAt('/resumes/4')
    const warning = await screen.findByRole('group', { name: /This is a base resume/ })
    expect(screen.queryByLabelText('Tone')).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(within(warning).getByRole('button', { name: 'Edit this one' }))

    const tone = screen.getByLabelText('Tone')
    await vi.waitFor(() => expect(tone).toHaveFocus())
    expect(screen.queryByRole('group', { name: /This is a base resume/ })).not.toBeInTheDocument()
    fireEvent.change(tone, { target: { value: '2' } })
    await expectNotice('Tone saved.')
    expect(sentBody(fetchMock, 'PUT /api/resumes/4')).toEqual({ name: 'Tech base', header_id: 1, tone_set_id: 2 })
    await expectNoA11yViolations()
  })

  it('goes back to showing a base version when editing is done', async () => {
    stub(22, resume(22))
    renderAt('/resumes/22')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this one' }))
    const done = await screen.findByRole('button', { name: 'Done editing' })
    await expectNoA11yViolations()
    fireEvent.click(done)
    // Read-only again, with the choice to edit or copy, and focus on "Edit this one".
    expect(screen.queryByLabelText('Tone')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done editing' })).not.toBeInTheDocument()
    await expectNotice('Done editing. Your changes to this resume are saved.')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit this one' })).toHaveFocus())
    await expectNoA11yViolations()
  })

  it('undoes and redoes a change, one step at a time', async () => {
    const toned = resume(24, { tone_set_id: 2 })
    const fetchMock = stub(24, resume(24), {
      'PUT /api/resumes/24': [
        { status: 200, body: toned },
        { status: 200, body: resume(24) },
        { status: 200, body: toned },
      ],
    })
    renderAt('/resumes/24')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this one' }))
    const undo = screen.getByRole('button', { name: 'Undo' })
    const redo = screen.getByRole('button', { name: 'Redo' })
    expect(screen.getByRole('group', { name: 'Undo and redo' })).toContainElement(undo)
    // Nothing to undo or redo yet.
    expect(undo).toHaveAttribute('aria-disabled', 'true')
    expect(redo).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: '2' } })
    await expectNotice('Tone saved.')
    expect(undo).toHaveAttribute('aria-disabled', 'false')
    await expectNoA11yViolations()
    undo.focus()
    fireEvent.click(undo)
    await expectNotice('Undid a change. Nothing more to undo.')
    expect(sentBody(fetchMock, 'PUT /api/resumes/24', 1)).toMatchObject({ tone_set_id: null })
    expect(screen.getByLabelText('Tone')).toHaveValue('')
    // Focus stays on Undo, now with nothing left to undo, and Redo can bring it back.
    expect(undo).toHaveFocus()
    expect(undo).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(redo)
    await expectNotice('Redid a change. Nothing more to redo.')
    expect(sentBody(fetchMock, 'PUT /api/resumes/24', 2)).toMatchObject({ tone_set_id: 2 })
    expect(screen.getByLabelText('Tone')).toHaveValue('2')
    expect(redo).toHaveAttribute('aria-disabled', 'true')
  })

  it('puts back a removed section with everything in it', async () => {
    const library = ['sections', 'narrative-content', 'skill-categories', 'experience', 'projects', 'bullet-points', 'education']
    const section = {
      row_id: 100,
      section_id: 2,
      title: 'Skills',
      entries: [
        {
          kind: 'category',
          row_id: 300,
          item_id: 6,
          position: 1,
          values: { category_name: 'Front End' },
          skills: [{ row_id: 400, item_id: 11, position: 1, text: 'React' }],
          bullets: [],
        },
      ],
    }
    const full = resume(25, { sections: [section] })
    const fetchMock = stub(25, full, {
      ...Object.fromEntries(library.map((path) => [`GET /api/${path}`, [{ status: 200, body: [] }]])),
      'PUT /api/resumes/25/sections': [{ status: 200, body: resume(25) }],
      'PUT /api/resumes/25/tree': [{ status: 200, body: full }],
    })
    renderAt('/resumes/25')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this one' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sections (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Skills' }))
    expect(await screen.findByRole('button', { name: 'Sections (0)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: 'Sections (1)' })).toBeInTheDocument()
    // The category comes back with the skill it showed, not its defaults.
    expect(sentBody(fetchMock, 'PUT /api/resumes/25/tree')).toEqual({
      sections: [{ section_id: 2, entries: [{ kind: 'category', item_id: 6, skill_ids: [11], bullet_ids: [] }] }],
    })
  })

  it('shows why an undo failed, keeping the step', async () => {
    stub(26, resume(26), {
      'PUT /api/resumes/26': [
        { status: 200, body: resume(26, { tone_set_id: 2 }) },
        { status: 404, body: errorBody('NOT_FOUND', "That item doesn't exist.") },
      ],
    })
    renderAt('/resumes/26')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this one' }))
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: '2' } })
    const undo = screen.getByRole('button', { name: 'Undo' })
    await vi.waitFor(() => expect(undo).toHaveAttribute('aria-disabled', 'false'))
    fireEvent.click(undo)
    expect(await screen.findByRole('alert')).toHaveTextContent("That item doesn't exist.")
    expect(undo).toHaveAttribute('aria-disabled', 'false')
    await expectNoA11yViolations()
  })

  it("doesn't warn again about a version already chosen for editing", async () => {
    stub(4, resume(4))
    renderAt('/resumes/4')
    expect(await screen.findByLabelText('Tone')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /This is a base resume/ })).not.toBeInTheDocument()
  })

  it('offers a copy instead of editing a base version, named so no other has its name', async () => {
    // "Copy of Tech base" is taken, so it starts as the next one free.
    const taken = [resume(1), resume(2, { name: 'copy of tech base' })]
    stub(5, resume(5), { 'GET /api/resumes': [{ status: 200, body: taken }] })
    renderAt('/resumes/5')
    fireEvent.click(await screen.findByRole('button', { name: 'Make a copy instead' }))
    const name = await screen.findByLabelText('Name of the copy')
    expect(name).toHaveValue('Copy 2 of Tech base')
    await vi.waitFor(() => expect(name).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Make a copy' })).toHaveFocus())
  })

  it('says when saving the tone fails', async () => {
    stub(18, resume(18), {
      'PUT /api/resumes/18': [{ status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') }],
    })
    renderAt('/resumes/18')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this one' }))
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: '2' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    expect(screen.getByLabelText('Tone')).toHaveAttribute('aria-invalid', 'true')
    await expectNoA11yViolations()
  })

  it("saves the header's values and reads the saved headers again", async () => {
    const teaching = { ...SAM, header_id: 5, headline: 'English Teacher' }
    const fetchMock = stub(19, resume(19), {
      'PUT /api/resumes/19/header': [{ status: 200, body: resume(19, { header_id: 5 }) }],
      'GET /api/headers': [{ status: 200, body: [SAM] }, { status: 200, body: [teaching, SAM] }],
    })
    renderAt('/resumes/19')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this one' }))
    fireEvent.click(screen.getByRole('button', { name: 'Header' }))
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: '\u0000new' } })
    fireEvent.change(screen.getByLabelText('New headline'), { target: { value: 'English Teacher' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save header' }))
    await expectNotice('Header saved.')
    expect(sentBody(fetchMock, 'PUT /api/resumes/19/header')).toMatchObject({
      full_name: 'Sam Rivera',
      headline: 'English Teacher',
    })
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/headers')).toHaveLength(2))
  })

  it("shows a posting's header, changed on the posting", async () => {
    stub(23, resume(23, { job_posting: SENT.job_posting }))
    renderAt('/resumes/23')
    // A version for a posting isn't a base version, so it's editable right away, with no
    // read-only view to go back to.
    fireEvent.click(await screen.findByRole('button', { name: 'Application header' }))
    expect(screen.queryByRole('button', { name: 'Done editing' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Tone')).toBeInTheDocument()
    expect(screen.getByText('Engineer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save header' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change the application header on the posting' })).toHaveAttribute(
      'href',
      '/postings/4',
    )
    await expectNoA11yViolations()
  })

  it('opens the sections to build them', async () => {
    const library = ['sections', 'narrative-content', 'skill-categories', 'experience', 'projects', 'bullet-points', 'education']
    const tree = { sections: [{ row_id: 100, section_id: 3, title: 'Experience', entries: [] }] }
    stub(
      21,
      resume(21, tree),
      Object.fromEntries(library.map((path) => [`GET /api/${path}`, [{ status: 200, body: [] }]])),
    )
    renderAt('/resumes/21')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this one' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sections (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Experience' }))
    expect(await screen.findByRole('group', { name: 'Items in Experience' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('renames, keeping the input when it fails', async () => {
    stub(6, resume(6), {
      'PUT /api/resumes/6': [{ status: 422, body: errorBody('VALIDATION_FAILED', 'Name is required.', 'name') }],
    })
    renderAt('/resumes/6')
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const name = screen.getByLabelText('New name for "Tech base"')
    expect(name).toHaveFocus()
    fireEvent.change(name, { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Name is required.')
    expect(name).toHaveValue(' ')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Rename' })).toHaveFocus())
  })

  it('shows a sent version read-only, and only renames it', async () => {
    const fetchMock = stub(7, resume(7, SENT), {
      'PUT /api/resumes/7': [{ status: 200, body: resume(7, { ...SENT, name: 'Acme (sent)' }) }],
    })
    renderAt('/resumes/7')
    // Its posting, linked.
    expect(await screen.findByRole('link', { name: 'Back to job posting' })).toHaveAttribute('href', '/postings/4')
    expect(screen.getByText(/so it's a record of what went out/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tech base' })).toHaveAttribute('href', '/resumes/1')
    expect(screen.queryByRole('group', { name: /This is a base resume/ })).not.toBeInTheDocument()
    expect(screen.getByText('Tone: None')).toBeInTheDocument()
    // Nothing can change, so there's nothing to undo.
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Application header' }))
    // The header's values are listed, with nothing to pick.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done editing' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const name = screen.getByLabelText('New name for "Acme resume"')
    await expectNoA11yViolations()
    fireEvent.change(name, { target: { value: 'Acme (sent)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Acme (sent) Resume' })).toBeInTheDocument()
    expect(sentBody(fetchMock, 'PUT /api/resumes/7').name).toBe('Acme (sent)')
  })

  it('makes a copy and opens it', async () => {
    const copy = resume(10, { name: 'Tech copy', based_on: { id: 8, name: 'Tech base' } })
    const fetchMock = stub(8, resume(8), {
      'POST /api/resumes/8/copies': [{ status: 201, body: copy }],
      'GET /api/resumes/10': [{ status: 200, body: copy }],
      'GET /api/headers': [{ status: 200, body: [SAM] }, { status: 200, body: [SAM] }],
      'GET /api/tone-sets': [{ status: 200, body: [] }, { status: 200, body: [] }],
      'GET /api/resumes': [{ status: 200, body: [resume(8)] }],
    })
    renderAt('/resumes/8')
    fireEvent.click(await screen.findByRole('button', { name: 'Make a copy' }))
    const name = await screen.findByLabelText('Name of the copy')
    expect(name).toHaveValue('Copy of Tech base')
    await vi.waitFor(() => expect(name).toHaveFocus())
    fireEvent.change(name, { target: { value: 'Tech copy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make copy' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Tech copy Resume' })).toBeInTheDocument()
    await expectNotice('Copied to a new base resume, "Tech copy".')
    expect(sentBody(fetchMock, 'POST /api/resumes/8/copies')).toEqual({ name: 'Tech copy' })
  })

  it('lists the copies a delete keeps, then deletes', async () => {
    stub(11, resume(11, SENT), {
      'DELETE /api/resumes/11': [{ status: 204 }],
      'GET /api/resumes': [{ status: 200, body: [] }],
    })
    renderAt('/resumes/11')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('group', { name: 'Delete "Acme resume"?' })
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(confirm).toHaveTextContent("Copies made from it: Acme copy. They're kept.")
    expect(confirm).toHaveTextContent('removes the record of what you sent')
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Resumes' })).toBeInTheDocument()
    await expectNotice('Deleted "Acme resume".')
  })

  it('keeps the confirm open when a delete fails', async () => {
    stub(12, resume(12), {
      'DELETE /api/resumes/12': [{ status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') }],
    })
    renderAt('/resumes/12')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Delete "Tech base"?' })).getByRole('button', { name: 'Delete' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus())
  })

  it("saves a cover letter's greeting and sign-off as they change, one after the other", async () => {
    const letter = {
      ...resume(0),
      resume_id: undefined,
      letter_id: 13,
      name: 'General letter',
      job_posting: { job_posting_id: 4, organization: 'Acme', role_title: 'Engineer' },
      addressee: 'Hiring Team',
      sign_off_id: 3,
      signature_name: null,
    }
    const fetchMock = stubApi({
      'GET /api/cover-letters/13': [{ status: 200, body: letter }],
      'GET /api/headers': [{ status: 200, body: [SAM] }],
      'GET /api/tone-sets': [{ status: 200, body: [] }],
      'GET /api/sign-offs': [{ status: 200, body: [{ sign_off_id: 3, text: 'Sincerely', used_by: [] }] }],
      'PUT /api/cover-letters/13': [
        { status: 200, body: { ...letter, addressee: 'Ms. Lee' } },
        { status: 200, body: { ...letter, addressee: 'Ms. Lee', sign_off_id: null } },
      ],
    })
    renderAt('/cover-letters/13')
    await openPreview()
    expect(await screen.findByText("Section names aren't printed in the letter.")).toBeInTheDocument()
    // A letter for a posting isn't a base version, so there's no warning.
    fireEvent.click(screen.getByRole('button', { name: 'Greeting' }))
    const greeting = screen.getByLabelText('Addressed to (after "Dear")')
    fireEvent.change(greeting, { target: { value: 'Ms. Lee' } })
    fireEvent.blur(greeting)
    // Changed right away, before the greeting's save comes back.
    fireEvent.click(screen.getByRole('button', { name: 'Sign-off' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Sign-off' }), { target: { value: '' } })
    await expectNotice('Sign-off saved.')
    await expectNoA11yViolations()
    const saved = { name: 'General letter', header_id: 1, tone_set_id: null, signature_name: null }
    expect(sentBody(fetchMock, 'PUT /api/cover-letters/13')).toEqual({ ...saved, addressee: 'Ms. Lee', sign_off_id: 3 })
    // The second save starts from what the first saved, so it keeps the new greeting.
    expect(sentBody(fetchMock, 'PUT /api/cover-letters/13', 1)).toEqual({
      ...saved,
      addressee: 'Ms. Lee',
      sign_off_id: null,
    })
  })

  it("writes a new sign-off, picks it, and starts the name as the header's", async () => {
    const letter = {
      ...resume(0),
      resume_id: undefined,
      letter_id: 14,
      name: 'General letter',
      job_posting: { job_posting_id: 4, organization: 'Acme', role_title: 'Engineer' },
      addressee: 'Hiring Team',
      sign_off_id: 3,
      signature_name: null,
    }
    const sincerely = { sign_off_id: 3, text: 'Sincerely', used_by: [] }
    const warm = { sign_off_id: 9, text: 'Warm regards', used_by: [] }
    const fetchMock = stubApi({
      'GET /api/cover-letters/14': [{ status: 200, body: letter }],
      'GET /api/headers': [{ status: 200, body: [SAM] }],
      'GET /api/tone-sets': [{ status: 200, body: [] }],
      'GET /api/sign-offs': [
        { status: 200, body: [sincerely] },
        { status: 200, body: [warm, sincerely] },
      ],
      'POST /api/cover-letters/14/sign-off/written': [{ status: 201, body: { ...letter, sign_off_id: 9 } }],
    })
    renderAt('/cover-letters/14')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign-off' }))
    expect(screen.getByLabelText('Name under the sign-off')).toHaveValue('Sam Rivera')
    fireEvent.click(screen.getByRole('button', { name: 'New sign-off' }))
    fireEvent.change(screen.getByLabelText('New sign-off'), { target: { value: 'Warm regards' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add sign-off' }))
    await expectNotice('Added the new sign-off.')
    expect(sentBody(fetchMock, 'POST /api/cover-letters/14/sign-off/written')).toEqual({ text: 'Warm regards' })
    await vi.waitFor(() => expect(screen.getByRole('combobox', { name: 'Sign-off' })).toHaveValue('9'))
    await expectNoA11yViolations()
  })

  it('says when there is nothing in it yet', async () => {
    stub(14, resume(14, { output: { parts: [], text: '' } }))
    renderAt('/resumes/14')
    await openPreview()
    expect(await screen.findByText('Nothing in this resume yet.')).toBeInTheDocument()
  })

  it('says it is loading', async () => {
    stubPendingApi()
    renderAt('/resumes/15')
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Resume' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when it fails to load', async () => {
    stubApi({
      'GET /api/resumes/16': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: resume(16) },
      ],
      'GET /api/headers': [{ status: 200, body: [] }, { status: 200, body: [] }],
      'GET /api/tone-sets': [{ status: 200, body: [] }, { status: 200, body: [] }],
    })
    renderAt('/resumes/16')
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Tech base Resume' })).toBeInTheDocument()
  })

  it('links back to the list when the resume does not exist', async () => {
    stub(17, {}, {
      'GET /api/resumes/17': [{ status: 404, body: errorBody('NOT_FOUND', "That item doesn't exist.") }],
    })
    renderAt('/resumes/17')
    expect(await screen.findByRole('alert')).toHaveTextContent("That item doesn't exist.")
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All resumes' })).toHaveAttribute('href', '/resumes')
  })
})
