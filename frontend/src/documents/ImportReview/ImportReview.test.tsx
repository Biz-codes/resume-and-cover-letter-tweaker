import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { DocKind } from '../../shared/api/documents'
import type { ImportBody, Imported, ImportedItem, Values } from '../../shared/api/imports'
import { expectNoA11yViolations } from '../../test/axe'
import ImportReview from './ImportReview'

const item = (values: Values, saved = false, similar: ImportedItem['similar'] = null): ImportedItem => ({
  values,
  saved,
  similar,
})

const IMPORTED: Imported = {
  header: {
    full_name: 'Sam Rivera',
    headline: 'Engineer',
    email: 'sam@example.com',
    phone: null,
    location: null,
    linkedin_url: null,
    github_url: null,
    portfolio_url: null,
  },
  header_saved: true,
  sections: [
    {
      ...item({ title: 'Summary' }, true),
      entries: [{ ...item({ content: 'I build tools for teams.' }), kind: 'narrative', skills: [], bullets: [] }],
    },
    {
      ...item({ title: 'Work Experience' }, false, { id: 3, name: 'Experience' }),
      entries: [
        {
          ...item({ role_title: 'Engineer', organization: 'Acme Corp', location: null, dates: '2020' }, false, {
            id: 7,
            name: 'Engineer, Acme (2020)',
          }),
          kind: 'experience',
          skills: [],
          bullets: [item({ content: 'Shipped it' }, true), item({ content: 'Led a team' })],
        },
      ],
    },
    {
      ...item({ title: 'Skills' }, true),
      entries: [
        {
          ...item({ category_name: 'Front End' }, true),
          kind: 'category',
          skills: [item({ skill_name: 'React' }, true), item({ skill_name: 'JS' }, false, { id: 9, name: 'JavaScript' })],
          bullets: [],
        },
      ],
    },
  ],
  addressee: null,
  sign_off: null,
  signature_name: null,
}

type OnSave = (body: ImportBody, tailor: boolean) => Promise<void>

const saving = (result: Promise<void> = Promise.resolve()) => vi.fn<OnSave>(() => result)

function renderReview({
  imported = IMPORTED,
  forPosting = false,
  kind = 'resume',
  onSave = saving(),
}: { imported?: Imported; forPosting?: boolean; kind?: DocKind; onSave?: ReturnType<typeof saving> } = {}) {
  const onCancel = vi.fn()
  render(<ImportReview kind={kind} imported={imported} forPosting={forPosting} onSave={onSave} onCancel={onCancel} />)
  return { onSave, onCancel }
}

const group = (name: string | RegExp) => screen.getByRole('group', { name })
const sent = (onSave: ReturnType<typeof saving>) => onSave.mock.calls[0][0]

describe('ImportReview', () => {
  it('shows what Claude read, marking what the library doesn’t have yet', async () => {
    renderReview()
    const name = screen.getByLabelText('Full name')
    await vi.waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveValue('Sam Rivera')
    expect(name).toHaveAccessibleDescription(
      'Claude read these from your resume. Items marked new are added to your library when you save.',
    )
    // The header is saved already, so it isn't new.
    expect(group('Header')).toBeInTheDocument()
    expect(group('Section: Summary')).toBeInTheDocument()
    expect(group('Narrative content new')).toBeInTheDocument()
    expect(group('Section: Work Experience new')).toBeInTheDocument()
    const role = group('Role: Engineer, Acme Corp new')
    expect(within(role).getByLabelText('Organization (required) of Engineer, Acme Corp')).toHaveValue('Acme Corp')
    expect(within(group('Bullets of Engineer, Acme Corp')).getAllByText('new')).toHaveLength(1)
    expect(within(role).getByText('Like "Engineer, Acme (2020)" in your library.')).toBeInTheDocument()
    // Labels that repeat on the form say where they are, for screen readers.
    expect(screen.getAllByRole('textbox', { name: 'Bullet text (required) under Engineer, Acme Corp' })).toHaveLength(2)
    expect(screen.getAllByRole('textbox', { name: 'Skill (required) in Front End' }).map((box) => (box as HTMLInputElement).value)).toEqual(['React', 'JS'])
    expect(screen.getByRole('textbox', { name: 'Narrative content text (required) in Summary' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('marks a saved item new once it’s changed, and not when it’s changed back', () => {
    renderReview()
    const summary = group('Section: Summary')
    const title = within(summary).getByLabelText('Section title (required) of Summary')
    fireEvent.change(title, { target: { value: 'About' } })
    expect(group('Section: About new')).toBeInTheDocument()
    fireEvent.change(title, { target: { value: 'Summary' } })
    expect(group('Section: Summary')).toBeInTheDocument()
  })

  it('uses the saved one instead, keeping focus on the button', async () => {
    const { onSave } = renderReview()
    const button = screen.getByRole('button', { name: 'Use the saved one for "Engineer, Acme Corp"' })
    button.focus()
    fireEvent.click(button)
    expect(button).toHaveFocus()
    expect(button).toHaveTextContent('Use what Claude read')
    expect(button).toHaveAccessibleName('Use what Claude read instead of "Engineer, Acme (2020)"')
    // Its fields give way to the saved one, which isn't new.
    const role = group('Role: Engineer, Acme (2020)')
    expect(within(role).queryByLabelText(/^Organization/)).not.toBeInTheDocument()
    expect(within(role).getByText('Using "Engineer, Acme (2020)" from your library.')).toBeInTheDocument()
    expect(screen.getByText('Using "Engineer, Acme (2020)" from your library.', { selector: '[aria-live]' })).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Use the saved one for "JS"' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save resume' }))
    const body = sent(onSave)
    expect(body.sections[1].entries[0]).toEqual({
      item_id: 7,
      values: {},
      kind: 'experience',
      skills: [],
      bullets: [
        { item_id: null, values: { content: 'Shipped it' } },
        { item_id: null, values: { content: 'Led a team' } },
      ],
    })
    expect(body.sections[2].entries[0].skills[1]).toEqual({ item_id: 9, values: {} })
    expect(body.header?.full_name).toBe('Sam Rivera')
    expect(onSave.mock.calls[0][1]).toBe(false)
  })

  it('switches back to what Claude read', () => {
    renderReview()
    const button = screen.getByRole('button', { name: 'Use the saved one for "Engineer, Acme Corp"' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(within(group('Role: Engineer, Acme Corp new')).getByLabelText(/^Organization/)).toHaveValue(
      'Acme Corp',
    )
    expect(screen.getByText('Using what Claude read.', { selector: '[aria-live]' })).toBeInTheDocument()
  })

  it('removes items and sections, moving focus on and saying so', async () => {
    const { onSave } = renderReview()
    // A bullet: focus goes to the next one in its list.
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Shipped it" from Engineer, Acme Corp' }))
    await vi.waitFor(() => expect(within(group('Bullets of Engineer, Acme Corp')).getByRole('textbox')).toHaveFocus())
    expect(screen.getByText('Removed "Shipped it".', { selector: '[aria-live]' })).toBeInTheDocument()
    // The last one: focus goes to the role it was under.
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Led a team" from Engineer, Acme Corp' }))
    await vi.waitFor(() =>
      expect(within(group('Role: Engineer, Acme Corp new')).getByLabelText('Title (required) of Engineer, Acme Corp')).toHaveFocus(),
    )
    expect(screen.queryByRole('group', { name: /^Bullets of/ })).not.toBeInTheDocument()
    // An item: focus goes to its section.
    fireEvent.click(screen.getByRole('button', { name: 'Remove "I build tools for teams." from Summary' }))
    await vi.waitFor(() =>
      expect(within(group('Section: Summary')).getByLabelText('Section title (required) of Summary')).toHaveFocus(),
    )
    // A section: focus goes to the next one.
    fireEvent.click(screen.getByRole('button', { name: 'Remove section "Summary"' }))
    await vi.waitFor(() =>
      expect(within(group('Section: Work Experience new')).getByLabelText('Section title (required) of Work Experience')).toHaveFocus(),
    )
    expect(screen.getByText('Removed section "Summary".', { selector: '[aria-live]' })).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Save resume' }))
    expect(sent(onSave).sections.map((section) => section.values.title)).toEqual([
      'Work Experience',
      'Skills',
    ])
  })

  it('says when no sections are left, moving focus to Save', async () => {
    renderReview({ imported: { ...IMPORTED, sections: [IMPORTED.sections[0]] } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove section "Summary"' }))
    expect(screen.getByText('No sections left.')).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Save resume' })).toHaveFocus())
    await expectNoA11yViolations()
  })

  it('points to an empty required field before saving', async () => {
    const { onSave } = renderReview()
    const organization = within(group('Role: Engineer, Acme Corp new')).getByLabelText(/^Organization/)
    fireEvent.change(organization, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save resume' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Fill this in, or remove it.')
    await vi.waitFor(() => expect(organization).toHaveFocus())
    expect(organization).toHaveAttribute('aria-invalid', 'true')
    expect(organization).toHaveAccessibleDescription('Fill this in, or remove it.')
    await expectNoA11yViolations()
    // Filling it in clears the error.
    fireEvent.change(organization, { target: { value: 'Acme' } })
    expect(organization).toHaveAttribute('aria-invalid', 'false')
  })

  it('saves a posting’s as is, or has Claude tailor it, saying so while it waits', async () => {
    const onSave = saving(new Promise(() => {}))
    renderReview({ forPosting: true, onSave })
    // A posting's uses the posting's header.
    expect(screen.queryByRole('group', { name: /^Header/ })).not.toBeInTheDocument()
    const title = within(group('Section: Summary')).getByLabelText('Section title (required) of Summary')
    await vi.waitFor(() => expect(title).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Save as is' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save, then Claude tailors it' }))
    expect(onSave.mock.calls[0][0].header).toBeNull()
    expect(onSave.mock.calls[0][1]).toBe(true)
    const tailoring = await screen.findByRole('button', { name: 'Tailoring…' })
    expect(tailoring).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Save as is' })).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText('Claude is tailoring your resume. This can take a few minutes.', { selector: '[aria-live]' }),
    ).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('shows a failed save, keeping what the user changed', async () => {
    const onSave = vi.fn<OnSave>(() => Promise.reject(new ApiError('AI_UNAVAILABLE', 'Claude isn’t available.', null, 503)))
    renderReview({ forPosting: true, onSave })
    fireEvent.click(screen.getByRole('button', { name: 'Save as is' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Claude isn’t available.')
    expect(screen.getByRole('button', { name: 'Save as is' })).toHaveAttribute('aria-disabled', 'false')
    expect(group('Section: Summary')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('reads a cover letter’s greeting and sign-off', async () => {
    const { onSave, onCancel } = renderReview({
      kind: 'cover_letter',
      forPosting: true,
      imported: {
        ...IMPORTED,
        sections: [IMPORTED.sections[0]],
        addressee: 'Ms. Lee',
        sign_off: item({ text: 'Warmly' }),
        signature_name: 'Sam',
      },
    })
    const greeting = screen.getByLabelText('Greeting, after “Dear”')
    await vi.waitFor(() => expect(greeting).toHaveFocus())
    expect(greeting).toHaveAccessibleDescription(
      'Claude read these from your cover letter. Items marked new are added to your library when you save.',
    )
    expect(within(group('Sign-off new')).getByLabelText('Sign-off (required)')).toHaveValue('Warmly')
    fireEvent.change(screen.getByLabelText('Name under the sign-off'), { target: { value: '' } })
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Save as is' }))
    expect(sent(onSave)).toMatchObject({
      addressee: 'Ms. Lee',
      sign_off: { item_id: null, values: { text: 'Warmly' } },
      signature_name: null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
