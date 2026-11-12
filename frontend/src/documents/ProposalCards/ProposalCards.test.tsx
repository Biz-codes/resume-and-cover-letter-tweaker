import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe as group, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { TreeSection } from '../../shared/api/documents'
import { expectNoA11yViolations } from '../../test/axe'
import type { ChatMessage, Proposal } from '../../shared/api/chat'
import { describe } from './describe'
import ProposalCards from './ProposalCards'

const SECTIONS: TreeSection[] = [{ row_id: 1, section_id: 3, title: 'Experience', entries: [] }]
const title = (id: number) => SECTIONS.find((section) => section.section_id === id)?.title ?? 'a section'

const base: Proposal = {
  id: 'toolu_1',
  action: 'reword',
  target: 'bullet',
  section_id: 3,
  item_id: 8,
  parent_kind: 'experience',
  parent_id: 7,
  new_text: 'Shipped weekly.',
  position: 0,
  reason: 'Shorter.',
  before: 'Shipped it',
  state: 'pending',
}
const NEW: Proposal = { ...base, id: 'toolu_2', action: 'add', item_id: 0, new_text: 'Mentored two.', before: '', reason: '' }

const message = (...proposals: Proposal[]): ChatMessage => ({
  message_id: 4,
  role: 'assistant',
  text: 'Try these.',
  about: null,
  proposals,
  created_at: null,
})

function renderCards(shown: ChatMessage = message(base, NEW), readOnly = false) {
  const onApply = vi.fn((_m: number, id: string) =>
    Promise.resolve(message(...(shown.proposals ?? []).map((p) => (p.id === id ? { ...p, state: 'applied' as const } : p)))),
  )
  const onState = vi.fn((_m: number, id: string, state: 'pending' | 'dismissed') =>
    Promise.resolve(message(...(shown.proposals ?? []).map((p) => (p.id === id ? { ...p, state } : p)))),
  )
  const onUpdate = vi.fn()
  const announce = vi.fn()
  const view = render(
    <ProposalCards
      message={shown}
      sections={SECTIONS}
      readOnly={readOnly}
      onApply={onApply}
      onState={onState}
      onUpdate={onUpdate}
      announce={announce}
    />,
  )
  return { onApply, onState, onUpdate, announce, view }
}

group('describe', () => {
  it('names each kind of change in a few words', () => {
    expect(describe(base, title)).toBe('Reword the bullet "Shipped it" in Experience')
    expect(describe(NEW, title)).toBe('Add new bullet in Experience')
    expect(describe({ ...base, action: 'add', target: 'experience', before: 'Engineer, Acme' }, title)).toBe(
      'Add the role Engineer, Acme in Experience',
    )
    expect(describe({ ...base, action: 'remove', target: 'skill', before: 'React' }, title)).toBe('Remove the skill React in Experience')
    expect(describe({ ...base, action: 'move', target: 'section', before: 'Projects', position: 1 }, title)).toBe(
      'Move the Projects section to position 1',
    )
    expect(describe({ ...base, action: 'move', position: 0 }, title)).toBe('Move the bullet "Shipped it" in Experience to the end')
    expect(describe({ ...base, section_id: 99 }, title)).toBe('Reword the bullet "Shipped it" in a section')
  })
})

group('ProposalCards', () => {
  it('shows each change with its before and after and reason, and Apply and Dismiss named for it', async () => {
    renderCards()
    const [reword, added] = within(screen.getByRole('list', { name: 'Proposed changes' })).getAllByRole('listitem')
    expect(within(reword).getByText('Before').nextElementSibling).toHaveTextContent('Shipped it')
    expect(within(reword).getByText('After').nextElementSibling).toHaveTextContent('Shipped weekly.')
    expect(within(reword).getByText('Shorter.')).toBeInTheDocument()
    expect(within(added).getByText('New text').nextElementSibling).toHaveTextContent('Mentored two.')
    expect(screen.getByRole('button', { name: 'Apply: Reword the bullet "Shipped it" in Experience' })).toHaveTextContent('Apply')
    expect(screen.getByRole('button', { name: 'Dismiss: Add new bullet in Experience' })).toHaveTextContent('Dismiss')
    await expectNoA11yViolations()
  })

  it('applies a change, announcing it and keeping focus on its card', async () => {
    const { onApply, onUpdate, announce } = renderCards()
    fireEvent.click(screen.getByRole('button', { name: 'Apply: Reword the bullet "Shipped it" in Experience' }))
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Applied: Reword the bullet "Shipped it" in Experience.'))
    expect(onApply).toHaveBeenCalledWith(4, 'toolu_1')
    expect(onUpdate.mock.calls[0][0].proposals[0].state).toBe('applied')
    await vi.waitFor(() => expect(document.getElementById('proposal-4-toolu_1')).toHaveFocus())
  })

  it('dismisses a change, and restores it', async () => {
    const { onState, announce, view } = renderCards()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Add new bullet in Experience' }))
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Dismissed: Add new bullet in Experience.'))
    expect(onState).toHaveBeenCalledWith(4, 'toolu_2', 'dismissed')
    view.rerender(
      <ProposalCards
        message={message(base, { ...NEW, state: 'dismissed' })}
        sections={SECTIONS}
        readOnly={false}
        onApply={vi.fn()}
        onState={onState}
        onUpdate={vi.fn()}
        announce={announce}
      />,
    )
    const card = document.getElementById('proposal-4-toolu_2')!
    expect(within(card).getByText('dismissed')).toHaveClass('tag')
    await expectNoA11yViolations()
    fireEvent.click(within(card).getByRole('button', { name: 'Restore: Add new bullet in Experience' }))
    await vi.waitFor(() => expect(announce).toHaveBeenLastCalledWith('Restored: Add new bullet in Experience.'))
    expect(onState).toHaveBeenLastCalledWith(4, 'toolu_2', 'pending')
  })

  it('shows why a change failed, and says nothing', async () => {
    const { onApply, announce } = renderCards()
    onApply.mockRejectedValueOnce(new ApiError('VALIDATION_FAILED', "This change doesn't fit the document as it is now.", null, 422))
    const apply = screen.getByRole('button', { name: 'Apply: Reword the bullet "Shipped it" in Experience' })
    apply.focus()
    fireEvent.click(apply)
    expect(await screen.findByRole('alert')).toHaveTextContent("This change doesn't fit the document as it is now.")
    expect(announce).not.toHaveBeenCalled()
    expect(apply).toHaveFocus()
    await expectNoA11yViolations()
  })

  it('marks an applied change, with nothing left to do', async () => {
    renderCards(message({ ...base, state: 'applied' }))
    expect(screen.getByText('applied')).toHaveClass('tag')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("only shows a sent document's cards", async () => {
    renderCards(message(base, { ...NEW, state: 'dismissed' }), true)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('shows nothing without proposals', () => {
    const { view } = renderCards(message())
    expect(view.container).toBeEmptyDOMElement()
  })
})
