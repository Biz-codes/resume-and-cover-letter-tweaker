import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Header } from '../api/headers'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, sentBody, stubApi, stubPendingApi, type Reply } from '../test/stubApi'
import DocumentRoute from './DocumentPage'
import DocumentsPage from './DocumentsPage'

const SAM: Header = {
  header_id: 1,
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
    expect(await screen.findByRole('heading', { level: 2, name: 'Tech base' })).toBeInTheDocument()
    expect(document.title).toBe('Tech base – Resume Tweaker')
    expect(screen.getByText('Base resume')).toBeInTheDocument()
    expect(screen.getByText('Tone: Tech')).toBeInTheDocument()
    const header = screen.getByRole('button', { name: 'Header' })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Sections (0)' })).toBeInTheDocument()
    fireEvent.click(header)
    expect(screen.getByText('sam@example.com')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Preview and copy' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'Experience' })).toBeInTheDocument()
    expect(screen.getByText('Empty.')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('copies the whole document or one part', async () => {
    stub(2, resume(2))
    const writeText = stubClipboard()
    renderAt('/resumes/2')
    fireEvent.click(await screen.findByRole('button', { name: 'Copy the whole resume' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Copied the whole resume.')
    expect(writeText).toHaveBeenCalledWith(OUTPUT.text)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Experience' }))
    expect(await screen.findByText('Copied Experience.')).toBeInTheDocument()
    expect(writeText).toHaveBeenLastCalledWith(OUTPUT.parts[1].text)
  })

  it('says when copying fails', async () => {
    stub(3, resume(3))
    stubClipboard(vi.fn(() => Promise.reject(new Error('denied'))))
    renderAt('/resumes/3')
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
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Tone saved.'))
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
    expect(screen.getByRole('status')).toHaveTextContent('Done editing. Your changes to this resume are saved.')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Edit this one' })).toHaveFocus())
    await expectNoA11yViolations()
  })

  it("doesn't warn again about a version already chosen for editing", async () => {
    stub(4, resume(4))
    renderAt('/resumes/4')
    expect(await screen.findByLabelText('Tone')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /This is a base resume/ })).not.toBeInTheDocument()
  })

  it('offers a copy instead of editing a base version', async () => {
    stub(5, resume(5))
    renderAt('/resumes/5')
    fireEvent.click(await screen.findByRole('button', { name: 'Make a copy instead' }))
    expect(screen.getByLabelText('Name of the copy')).toHaveValue('Copy of Tech base')
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
    const fetchMock = stub(19, resume(19, { job_posting: SENT.job_posting }), {
      'PUT /api/resumes/19/header': [{ status: 200, body: resume(19, { header_id: 5 }) }],
      'GET /api/headers': [{ status: 200, body: [SAM] }, { status: 200, body: [teaching, SAM] }],
    })
    renderAt('/resumes/19')
    // A version for a posting isn't a base version, so it's editable right away, with no
    // read-only view to go back to.
    fireEvent.click(await screen.findByRole('button', { name: 'Header' }))
    expect(screen.queryByRole('button', { name: 'Done editing' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: '\u0000new' } })
    fireEvent.change(screen.getByLabelText('New headline'), { target: { value: 'English Teacher' } })
    // A typed value saves when the field is left.
    fireEvent.blur(screen.getByLabelText('New headline'))
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Header saved.'))
    expect(sentBody(fetchMock, 'PUT /api/resumes/19/header')).toMatchObject({
      full_name: 'Sam Rivera',
      headline: 'English Teacher',
    })
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/headers')).toHaveLength(2))
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
    expect(await screen.findByText('For Acme: Engineer')).toBeInTheDocument()
    expect(screen.getByText(/so it's a record of what went out/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tech base' })).toHaveAttribute('href', '/resumes/1')
    expect(screen.queryByRole('group', { name: /This is a base resume/ })).not.toBeInTheDocument()
    expect(screen.getByText('Tone: None')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Header' }))
    expect(screen.queryByRole('button', { name: 'Save header' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const name = screen.getByLabelText('New name for "Acme resume"')
    await expectNoA11yViolations()
    fireEvent.change(name, { target: { value: 'Acme (sent)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Acme (sent)' })).toBeInTheDocument()
    expect(sentBody(fetchMock, 'PUT /api/resumes/7').name).toBe('Acme (sent)')
  })

  it('makes a copy and opens it', async () => {
    const copy = resume(10, { name: 'Tech copy', based_on: { id: 8, name: 'Tech base' } })
    const fetchMock = stub(8, resume(8), {
      'POST /api/resumes/8/copies': [{ status: 201, body: copy }],
      'GET /api/resumes/10': [{ status: 200, body: copy }],
      'GET /api/headers': [{ status: 200, body: [SAM] }, { status: 200, body: [SAM] }],
      'GET /api/tone-sets': [{ status: 200, body: [] }, { status: 200, body: [] }],
    })
    renderAt('/resumes/8')
    fireEvent.click(await screen.findByRole('button', { name: 'Make a copy' }))
    const name = screen.getByLabelText('Name of the copy')
    expect(name).toHaveFocus()
    expect(name).toHaveAccessibleDescription(/a new base resume with the same tone, header/)
    fireEvent.change(name, { target: { value: 'Tech copy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make copy' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Tech copy' })).toBeInTheDocument()
    await vi.waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Copied to a new base resume, "Tech copy".'),
    )
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
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Deleted "Acme resume".'))
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
    expect(await screen.findByText(/section names are for you only/)).toBeInTheDocument()
    // A letter for a posting isn't a base version, so there's no warning.
    fireEvent.click(screen.getByRole('button', { name: 'Greeting' }))
    const greeting = screen.getByLabelText(/Who it's addressed to/)
    fireEvent.change(greeting, { target: { value: 'Ms. Lee' } })
    fireEvent.blur(greeting)
    // Changed right away, before the greeting's save comes back.
    fireEvent.click(screen.getByRole('button', { name: 'Sign-off' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Sign-off' }), { target: { value: '' } })
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sign-off saved.'))
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

  it('says when there is nothing in it yet', async () => {
    stub(14, resume(14, { output: { parts: [], text: '' } }))
    renderAt('/resumes/14')
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
    expect(await screen.findByRole('heading', { level: 2, name: 'Tech base' })).toBeInTheDocument()
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
