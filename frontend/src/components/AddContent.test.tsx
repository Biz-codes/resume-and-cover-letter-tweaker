import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { TreeSection } from '../api/documents'
import { expectNoA11yViolations } from '../test/axe'
import AddContent from './AddContent'
import type { Library } from './treeItems'

const role = (id: number, organization: string, bullets: { bullet_id: number; content: string }[] = []) => ({
  experience_id: id,
  role_title: 'Engineer',
  organization,
  location: null,
  dates: null,
  bullets,
  sections: [],
  used_by: [],
})
const nothing = { narrative_content: [], skill_categories: [], projects: [], bullets: [], education: [], used_by: [] }
const LIBRARY: Library = {
  sections: [
    {
      id: 3,
      title: 'Experience',
      built_in: true,
      ...nothing,
      experience: [{ experience_id: 8, role_title: 'Engineer', organization: 'Beta', dates: null }],
    },
    { id: 12, title: 'Talks', built_in: false, ...nothing, experience: [] },
  ],
  narrative: [],
  categories: [],
  experience: [
    role(7, 'Acme'),
    role(8, 'Beta'),
    role(9, 'Gamma', [
      { bullet_id: 20, content: 'Led the redesign.' },
      { bullet_id: 21, content: 'Cut load time in half.' },
      { bullet_id: 22, content: 'Mentored two engineers.' },
    ]),
  ],
  projects: [],
  bullets: [],
  education: [],
}
const EMPTY: TreeSection = { row_id: 101, section_id: 3, title: 'Experience', entries: [] }
const PLACED: TreeSection = {
  ...EMPTY,
  entries: [
    {
      kind: 'experience',
      row_id: 300,
      item_id: 7,
      position: 1,
      values: { role_title: 'Engineer', organization: 'Acme', location: null, dates: null },
      skills: [],
      bullets: [{ row_id: 400, item_id: 21, position: 1, text: 'Cut load time in half.' }],
    },
  ],
}

function renderForm(section = EMPTY, onAdd = vi.fn(() => Promise.resolve()), onWrite = vi.fn(() => Promise.resolve())) {
  render(<AddContent section={section} library={LIBRARY} onAdd={onAdd} onWrite={onWrite} />)
  return { onAdd, onWrite }
}

const options = (select: HTMLElement) => [...select.querySelectorAll('option')].map((option) => option.textContent)

describe('AddContent', () => {
  it("shows an empty section's form right away, starting with the type the section lists", async () => {
    renderForm()
    expect(screen.getByLabelText('Type of content')).toHaveValue('experience')
    const roles = screen.getByLabelText('Role')
    expect([...roles.querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
      'Listed under Experience',
      'Others',
    ])
    expect(options(roles)).toEqual(['Choose a role…', 'Engineer, Beta', 'Engineer, Acme', 'Engineer, Gamma', 'New role…'])
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Experience' })).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
  })

  it('adds a saved item (with its defaults), leaving out the ones already placed, then closes to its button', async () => {
    const { onAdd } = renderForm(PLACED)
    const open = screen.getByRole('button', { name: 'Add content to Experience' })
    fireEvent.click(open)
    await vi.waitFor(() => expect(screen.getByLabelText('Type of content')).toHaveFocus())
    expect(options(screen.getByLabelText('Role'))).not.toContain('Engineer, Acme')
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: '9' } })
    // Its bullets come with it, as its defaults, so there's nothing more to choose here.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Experience' }))
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledWith('experience', 9))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Add content to Experience' })).toHaveFocus())
  })

  it("writes a new item in its type's own fields", async () => {
    const { onWrite } = renderForm()
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'new' } })
    expect(screen.getByRole('group', { name: 'New role' })).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.change(screen.getByLabelText('Role title (required)'), { target: { value: 'English Teacher' } })
    fireEvent.change(screen.getByLabelText('Organization (required)'), { target: { value: 'Lincoln High' } })
    fireEvent.change(screen.getByLabelText('Dates'), { target: { value: '2015 - 2019' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Experience' }))
    await vi.waitFor(() =>
      expect(onWrite).toHaveBeenCalledWith({
        kind: 'experience',
        role_title: 'English Teacher',
        organization: 'Lincoln High',
        dates: '2015 - 2019',
      }),
    )
  })

  it('changes type, starting the item over', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'new' } })
    fireEvent.change(screen.getByLabelText('Type of content'), { target: { value: 'narrative' } })
    expect(screen.getByLabelText('Narrative content')).toHaveValue('')
    expect(screen.queryByLabelText('Role title (required)')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Narrative content'), { target: { value: 'new' } })
    expect(screen.getByLabelText('Text (required)').tagName).toBe('TEXTAREA')
  })

  it('highlights the field a refusal names and keeps the input', async () => {
    renderForm(
      PLACED,
      vi.fn(),
      vi.fn(() => Promise.reject(new ApiError('VALIDATION_FAILED', 'Invalid organization: required.', 'organization', 422))),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add content to Experience' }))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'new' } })
    fireEvent.change(screen.getByLabelText('Role title (required)'), { target: { value: 'Tutor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Experience' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid organization')
    const organization = screen.getByLabelText('Organization (required)')
    expect(organization).toHaveAttribute('aria-invalid', 'true')
    expect(organization).toHaveAccessibleDescription('Invalid organization: required.')
    expect(screen.getByLabelText('Role title (required)')).toHaveValue('Tutor')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Add content to Experience' })).toHaveFocus())
  })

  it('asks for the type first when the section lists nothing', async () => {
    renderForm({ ...EMPTY, section_id: 12, title: 'Talks' })
    expect(screen.getByLabelText('Type of content')).toHaveValue('')
    expect(options(screen.getByLabelText('Type of content'))).toEqual([
      'Choose a type…',
      'Role',
      'Project',
      'Skill category',
      'Education',
      'Bullet',
      'Narrative content',
    ])
    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })
})
