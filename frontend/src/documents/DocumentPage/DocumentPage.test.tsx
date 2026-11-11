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
  in_progress: [],
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

function resume(id: number, values: object = {}) {
  return {
    resume_id: id,
    name: 'Tech',
    header_id: 1,
    tone_set_id: null,
    job_posting: null,
    based_on: null,
    locked: false,
    hidden: false,
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
  based_on: { id: 1, name: 'Tech Base Resume' },
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

function renderAt(path: string, state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/resumes" element={<DocumentsPage kind="resume" />} />
        <Route path="/postings/:id" element={<h2>The posting</h2>} />
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
    expect(await screen.findByRole('heading', { level: 2, name: 'Tech Base Resume' })).toBeInTheDocument()
    await vi.waitFor(() => expect(document.title).toBe('Tech Base Resume – Resume Tweaker'))
    // The title is shown again under Contents, with New title.
    expect(screen.getByText('Tech Base Resume', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New title' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tone')).toHaveValue('2')
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

  it('edits a base version in place, saying what editing does', async () => {
    const saved = resume(4, { tone_set_id: 2 })
    const fetchMock = stub(4, resume(4), { 'PUT /api/resumes/4': [{ status: 200, body: saved }] })
    renderAt('/resumes/4')
    expect(await screen.findByText('Edits to the resume below save instantly.')).toBeInTheDocument()
    expect(screen.getByText('If you want to preserve this version, select "Copy" instead.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy to a new base resume' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete resume' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: '2' } })
    await expectNotice('Tone saved.')
    expect(sentBody(fetchMock, 'PUT /api/resumes/4')).toEqual({ name: 'Tech', header_id: 1, tone_set_id: 2 })
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
    await screen.findByRole('heading', { level: 2, name: 'Tech Base Resume' })
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
    await screen.findByRole('heading', { level: 2, name: 'Tech Base Resume' })
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
    await screen.findByRole('heading', { level: 2, name: 'Tech Base Resume' })
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: '2' } })
    const undo = screen.getByRole('button', { name: 'Undo' })
    await vi.waitFor(() => expect(undo).toHaveAttribute('aria-disabled', 'false'))
    fireEvent.click(undo)
    expect(await screen.findByRole('alert')).toHaveTextContent("That item doesn't exist.")
    expect(undo).toHaveAttribute('aria-disabled', 'false')
    await expectNoA11yViolations()
  })

  it('offers a copy named so no other has its name', async () => {
    // "Copy of Tech" is taken, so it starts as the next one free.
    const taken = [resume(1), resume(2, { name: 'copy of tech' })]
    stub(5, resume(5), { 'GET /api/resumes': [{ status: 200, body: taken }] })
    renderAt('/resumes/5')
    fireEvent.click(await screen.findByRole('button', { name: 'Copy to a new base resume' }))
    const name = await screen.findByRole('textbox', { name: 'Name of the copy' })
    expect(name).toHaveValue('Copy 2 of Tech')
    await vi.waitFor(() => expect(name).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Copy to a new base resume' })).toHaveFocus())
  })

  it('says when saving the tone fails', async () => {
    stub(18, resume(18), {
      'PUT /api/resumes/18': [{ status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') }],
    })
    renderAt('/resumes/18')
    await screen.findByRole('heading', { level: 2, name: 'Tech Base Resume' })
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
    await screen.findByRole('heading', { level: 2, name: 'Tech Base Resume' })
    fireEvent.click(screen.getByRole('button', { name: 'Header' }))
    fireEvent.click(screen.getByRole('button', { name: 'New headline' }))
    const dialog = screen.getByRole('dialog', { name: 'New headline' })
    fireEvent.change(within(dialog).getByLabelText('Headline'), { target: { value: 'English Teacher' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Application header' }))
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
    await screen.findByRole('heading', { level: 2, name: 'Tech Base Resume' })
    fireEvent.click(screen.getByRole('button', { name: 'Sections (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Experience' }))
    expect(await screen.findByRole('group', { name: 'Items in Experience' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('renames in a modal, keeping what was typed when it fails', async () => {
    const fetchMock = stub(6, resume(6), {
      'PUT /api/resumes/6': [
        { status: 422, body: errorBody('VALIDATION_FAILED', 'Name is required.', 'name') },
        { status: 200, body: resume(6, { name: 'Mentoring' }) },
      ],
    })
    renderAt('/resumes/6')
    fireEvent.click(await screen.findByRole('button', { name: 'New title' }))
    const dialog = screen.getByRole('dialog', { name: 'New title' })
    await vi.waitFor(() => expect(within(dialog).getByRole('heading', { name: 'New title' })).toHaveFocus())
    const name = within(dialog).getByRole('textbox', { name: 'Title' })
    expect(name).toHaveValue('Tech')
    // What the app adds after the name is shown beside it, and read with it.
    expect(name).toHaveAccessibleDescription('Followed by "Base Resume".')
    await expectNoA11yViolations()
    fireEvent.change(name, { target: { value: ' ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Name is required.')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Followed by "Base Resume". Name is required.')
    expect(name).toHaveValue(' ')
    await expectNoA11yViolations()
    fireEvent.change(name, { target: { value: 'Mentoring' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    // The modal closes as the notice opens, and focus goes back to New title after it.
    await expectNotice('Renamed to "Mentoring Base Resume".')
    expect(screen.queryByRole('dialog', { name: 'New title' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Mentoring Base Resume' })).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'New title' })).toHaveFocus())
    const puts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(JSON.parse(String((puts.at(-1)![1] as RequestInit).body)).name).toBe('Mentoring')
  })

  it('closes the title modal with Cancel, saving nothing', async () => {
    const fetchMock = stub(26, resume(26))
    renderAt('/resumes/26')
    fireEvent.click(await screen.findByRole('button', { name: 'New title' }))
    const dialog = screen.getByRole('dialog', { name: 'New title' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), { target: { value: 'Teaching' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'New title' })).toHaveFocus())
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toEqual([])
  })

  it('shows a sent version read-only, and only renames it', async () => {
    const fetchMock = stub(7, resume(7, SENT), {
      'PUT /api/resumes/7': [{ status: 200, body: resume(7, { ...SENT, name: 'Acme (sent)' }) }],
    })
    renderAt('/resumes/7')
    // Its posting, linked.
    expect(await screen.findByRole('link', { name: 'Back to job posting' })).toHaveAttribute('href', '/postings/4')
    expect(screen.getByText(/so the only field you can edit is the title below\./)).toBeInTheDocument()
    expect(
      screen.getByText('If you want to use this resume as a template for a new application, select "Copy".'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tech Base Resume' })).toHaveAttribute('href', '/resumes/1')
    expect(screen.getByText('Tone: None')).toBeInTheDocument()
    // Nothing else can change, so there's nothing to undo, and it can be hidden, not deleted.
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete resume' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Application header' }))
    // The header's values are listed, with nothing to pick.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await expectNoA11yViolations()
    // A version for a posting's title ends in "Resume", not "Base Resume".
    expect(screen.getByRole('heading', { level: 2, name: 'Acme resume Resume' })).toBeInTheDocument()
    expect(screen.queryByText('Base resume')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New title' }))
    const name = within(screen.getByRole('dialog', { name: 'New title' })).getByRole('textbox', { name: 'Title' })
    expect(name).toHaveAccessibleDescription('Followed by "Resume".')
    fireEvent.change(name, { target: { value: 'Acme (sent)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await expectNotice('Renamed to "Acme (sent) Resume".')
    expect(screen.getByRole('heading', { level: 2, name: 'Acme (sent) Resume' })).toBeInTheDocument()
    expect(sentBody(fetchMock, 'PUT /api/resumes/7').name).toBe('Acme (sent)')
  })

  it('hides and unhides a sent version, keeping focus on the button', async () => {
    const fetchMock = stub(27, resume(27, SENT), {
      'PUT /api/resumes/27/hidden': [
        { status: 200, body: resume(27, { ...SENT, hidden: true }) },
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
      ],
    })
    renderAt('/resumes/27')
    const button = await screen.findByRole('button', { name: 'Hide' })
    button.focus()
    fireEvent.click(button)
    await expectNotice('Hid "Acme resume".')
    expect(sentBody(fetchMock, 'PUT /api/resumes/27/hidden')).toEqual({ hidden: true })
    expect(button).toHaveTextContent('Unhide')
    expect(screen.getByText('hidden')).toBeInTheDocument()
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    expect(button).toHaveTextContent('Unhide')
    await expectNoA11yViolations()
  })

  it('shows it is hiding', async () => {
    stub(28, resume(28, SENT))
    const fetchMock = vi.mocked(fetch)
    const answer = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, init) => (init?.method === 'PUT' ? new Promise<Response>(() => {}) : answer(url, init)))
    renderAt('/resumes/28')
    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }))
    expect(await screen.findByRole('button', { name: 'Hiding…' })).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
  })

  it('makes a copy and opens it', async () => {
    const copy = resume(10, { name: 'Tech copy', based_on: { id: 8, name: 'Tech Base Resume' } })
    const fetchMock = stub(8, resume(8), {
      'POST /api/resumes/8/copies': [{ status: 201, body: copy }],
      'GET /api/resumes/10': [{ status: 200, body: copy }],
      'GET /api/headers': [{ status: 200, body: [SAM] }, { status: 200, body: [SAM] }],
      'GET /api/tone-sets': [{ status: 200, body: [] }, { status: 200, body: [] }],
      'GET /api/resumes': [{ status: 200, body: [resume(8)] }],
    })
    renderAt('/resumes/8')
    fireEvent.click(await screen.findByRole('button', { name: 'Copy to a new base resume' }))
    const name = await screen.findByRole('textbox', { name: 'Name of the copy' })
    expect(name).toHaveValue('Copy of Tech')
    // The copy is a base version, so its name is shown with "Base Resume" after it.
    expect(name).toHaveAccessibleDescription('Followed by "Base Resume".')
    await vi.waitFor(() => expect(name).toHaveFocus())
    fireEvent.change(name, { target: { value: 'Tech copy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make copy' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Tech copy Base Resume' })).toBeInTheDocument()
    await expectNotice('Copied to "Tech copy Base Resume". The original is unchanged.')
    expect(sentBody(fetchMock, 'POST /api/resumes/8/copies')).toEqual({ name: 'Tech copy' })
  })

  it('lists the copies a delete keeps, then deletes', async () => {
    stub(11, resume(11, { copies: SENT.copies }), {
      'DELETE /api/resumes/11': [{ status: 204 }],
      'GET /api/resumes': [{ status: 200, body: [] }],
    })
    renderAt('/resumes/11')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete resume' }))
    const confirm = screen.getByRole('group', { name: 'Delete resume "Tech Base Resume"?' })
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(confirm).toHaveTextContent("Copies made from it: Acme copy. They're kept.")
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete resume' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Resumes' })).toBeInTheDocument()
    await expectNotice('Deleted "Tech Base Resume".')
  })

  it("names a posting's resume by its posting when deleting it, and goes back to the posting", async () => {
    stub(14, resume(14, { name: 'Acme resume', job_posting: SENT.job_posting }), {
      'DELETE /api/resumes/14': [{ status: 204 }],
    })
    renderAt('/resumes/14', { back: '/postings/4' })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete resume' }))
    const confirm = screen.getByRole('group', { name: 'Delete resume for Engineer at Acme?' })
    await expectNoA11yViolations()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete resume' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'The posting' })).toBeInTheDocument()
  })

  it('keeps the confirm open when a delete fails', async () => {
    stub(12, resume(12), {
      'DELETE /api/resumes/12': [{ status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') }],
    })
    renderAt('/resumes/12')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete resume' }))
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Delete resume "Tech Base Resume"?' })).getByRole('button', { name: 'Delete resume' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Delete resume' })).toHaveFocus())
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

  it("reviews Claude's draft in place of the tree, with Undo, then approves it", async () => {
    const posting = { job_posting_id: 4, organization: 'Acme', role_title: 'Engineer' }
    const texts = [
      { key: 1, kind: 'narrative', text: 'Builds accessible React apps.', replaces: 6 },
      { key: 2, kind: 'narrative', text: 'Teaches web basics.', replaces: null },
    ]
    const reworded = { kind: 'narrative', item_id: 6, text_key: 1, reason: 'Names React.' }
    const added = { kind: 'narrative', item_id: null, text_key: 2, reason: 'Mentions mentoring.' }
    const draft = (...entries: object[]) => ({
      starting_document: null,
      starting_reason: 'There are no earlier resumes.',
      texts,
      sections: [{ section_id: 1, reason: 'A short summary.', entries }],
    })
    const drafted = (...entries: object[]) =>
      resume(5, { name: 'Engineer at Acme', job_posting: posting, output: { parts: [], text: '' }, draft: draft(...entries) })
    const finished = resume(5, {
      name: 'Engineer at Acme',
      job_posting: posting,
      draft: null,
      sections: [
        {
          row_id: 50,
          section_id: 1,
          title: 'Summary',
          entries: [{ kind: 'narrative', row_id: 60, item_id: 6, position: 1, values: { content: 'Builds accessible apps.' }, skills: [], bullets: [] }],
        },
      ],
    })
    const none = { skill_categories: [], experience: [], projects: [], bullets: [], education: [], used_by: [] }
    const fetchMock = stub(5, drafted(reworded, added), {
      'GET /api/sections': [
        { status: 200, body: [{ id: 1, title: 'Summary', built_in: true, ...none, narrative_content: [{ content_id: 6, content: 'Builds accessible apps.' }] }] },
      ],
      'GET /api/narrative-content': [{ status: 200, body: [{ content_id: 6, content: 'Builds accessible apps.', sections: [], used_by: [] }] }],
      ...Object.fromEntries(
        ['skill-categories', 'experience', 'projects', 'bullet-points', 'education'].map((path) => [
          `GET /api/${path}`,
          [{ status: 200, body: [] }],
        ]),
      ),
      'PUT /api/resumes/5/draft': [
        { status: 200, body: drafted(reworded) },
        { status: 200, body: drafted(reworded, added) },
        { status: 200, body: drafted({ ...reworded, use_original: true }, added) },
      ],
      'POST /api/resumes/5/draft/finish': [{ status: 200, body: finished }],
    })
    renderAt('/resumes/5')
    expect(
      await screen.findByText("Below is Claude's draft. Nothing is saved to this resume or your library until you approve the first draft."),
    ).toBeInTheDocument()
    expect(screen.getByText(/^The purpose of this draft is just to accept or reject Claude's initial suggestions/)).toBeInTheDocument()
    // It's only reviewed, so there's no saving-as-you-edit note, and nothing to copy yet.
    expect(screen.queryByText('Edits to the resume below save instantly.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy to a new base resume' })).not.toBeInTheDocument()
    // The draft is what there is to do first, so it starts open.
    expect(screen.getByRole('button', { name: 'Sections (1)' })).toHaveAttribute('aria-expanded', 'true')
    await screen.findByRole('list', { name: 'Items in Summary' })
    await expectNoA11yViolations()

    // Rejecting the new text saves the draft only, and Undo puts it back.
    fireEvent.click(await screen.findByRole('button', { name: 'Reject Text: "Teaches web basics." in Summary' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'false'))
    expect(sentBody(fetchMock, 'PUT /api/resumes/5/draft').sections[0].entries).toEqual([reworded])
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await expectNotice('Undid a change. Nothing more to undo.')
    expect(sentBody(fetchMock, 'PUT /api/resumes/5/draft', 1).sections[0].entries).toEqual([reworded, added])

    // Back to the original wording, which the draft announces itself.
    fireEvent.click(await screen.findByRole('button', { name: 'Rationale for Text: "Builds accessible React apps." in Summary' }))
    const useOriginal = screen.getByRole('button', { name: 'Use the original wording of Text: "Builds accessible React apps." in Summary' })
    useOriginal.focus()
    fireEvent.click(useOriginal)
    await vi.waitFor(() => expect(screen.getByText('Using the original wording.')).toHaveAttribute('aria-live', 'polite'))
    // The button stays where it was, now offering the way back, and keeps focus.
    expect(screen.getByRole('button', { name: `Use Claude's wording of Text: "Builds accessible apps." in Summary` })).toHaveFocus()

    // Claude's rewording is now unused, so approving asks whether to keep it.
    fireEvent.click(screen.getByRole('button', { name: 'Approve first draft' }))
    const dialog = await screen.findByRole('dialog', { name: "Claude's text you didn't use" })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Builds accessible React apps.' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve first draft' }))
    await expectNotice("Approved the first draft. The resume has what you kept, and Claude's text you kept for later is in your library.")
    expect(sentBody(fetchMock, 'POST /api/resumes/5/draft/finish')).toEqual({ keep: [1] })
    // The usual tree is back, and the library rows it saved can't be undone.
    expect(screen.queryByText(/Below is Claude's draft/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve first draft' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sections (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('heading', { level: 2, name: 'Engineer at Acme Resume' })).toHaveFocus()
    await expectNoA11yViolations()
  })

  it("reviews Claude's greeting in a letter's draft, saved with its tree, with Undo", async () => {
    const greeting = { addressee: 'Jordan Rivera', reason: 'The posting names the hiring manager.', use_default: false }
    const talks = { section_id: 12, reason: 'The posting mentions speaking.', entries: [] }
    const drafted = (useDefault: boolean, sections: object[] = [talks]) => ({
      ...resume(0),
      resume_id: undefined,
      letter_id: 15,
      name: 'Engineer at Acme',
      job_posting: { job_posting_id: 4, organization: 'Acme', role_title: 'Engineer' },
      addressee: 'Acme Hiring Team',
      sign_off_id: null,
      signature_name: null,
      output: { parts: [], text: '' },
      draft: { starting_document: null, starting_reason: 'No earlier letters.', texts: [], sections, greeting: { ...greeting, use_default: useDefault } },
    })
    const none = { skill_categories: [], experience: [], projects: [], bullets: [], education: [], used_by: [] }
    const fetchMock = stubApi({
      'GET /api/cover-letters/15': [{ status: 200, body: drafted(false) }],
      'GET /api/headers': [{ status: 200, body: [SAM] }],
      'GET /api/tone-sets': [{ status: 200, body: [] }],
      'GET /api/sign-offs': [{ status: 200, body: [] }],
      'GET /api/sections': [{ status: 200, body: [{ id: 12, title: 'Talks', built_in: false, narrative_content: [], ...none }] }],
      ...Object.fromEntries(
        ['narrative-content', 'skill-categories', 'experience', 'projects', 'bullet-points', 'education'].map((path) => [
          `GET /api/${path}`,
          [{ status: 200, body: [] }],
        ]),
      ),
      'PUT /api/cover-letters/15/draft': [
        { status: 200, body: drafted(true) },
        { status: 200, body: drafted(true, []) },
        { status: 200, body: drafted(true) },
      ],
    })
    renderAt('/cover-letters/15')
    // Claude's greeting is part of what there is to review, so it starts open too, in place of
    // the greeting's field.
    expect(await screen.findByRole('button', { name: 'Greeting' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByLabelText('Addressed to (after "Dear")')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Greeting' })).toHaveTextContent('Dear Jordan Rivera,Source: Claude')
    await screen.findByRole('list', { name: 'Sections' })
    await expectNoA11yViolations()

    fireEvent.click(screen.getByRole('button', { name: 'Rationale for greeting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use the usual greeting' }))
    await vi.waitFor(() => expect(screen.getByText('Using the usual greeting.')).toHaveAttribute('aria-live', 'polite'))
    expect(sentBody(fetchMock, 'PUT /api/cover-letters/15/draft')).toEqual({ sections: [talks], use_default_greeting: true })
    // A change to the tree keeps the greeting chosen.
    fireEvent.click(screen.getByRole('button', { name: 'Reject section "Talks"' }))
    await vi.waitFor(() => expect(sentBody(fetchMock, 'PUT /api/cover-letters/15/draft', 1)).toEqual({ sections: [], use_default_greeting: true }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await expectNotice('Undid a change. 1 more can be undone.')
    expect(sentBody(fetchMock, 'PUT /api/cover-letters/15/draft', 2)).toEqual({ sections: [talks], use_default_greeting: true })
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
    expect(await screen.findByRole('heading', { level: 2, name: 'Tech Base Resume' })).toBeInTheDocument()
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
