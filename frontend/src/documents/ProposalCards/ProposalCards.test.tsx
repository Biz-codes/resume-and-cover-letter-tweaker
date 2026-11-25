import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe as group, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { FlagChoice, TreeSection } from '../../shared/api/documents'
import { expectNoA11yViolations } from '../../test/axe'
import type { AnyProposal, ChatMessage, Proposal } from '../../shared/api/chat'
import { describe } from './describe'
import ProposalCards, { WaitingForYou } from './ProposalCards'

const SECTIONS: TreeSection[] = [{ row_id: 1, section_id: 3, title: 'Experience', entries: [] }]

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

const message = (...proposals: AnyProposal[]): ChatMessage => ({
  message_id: 4,
  role: 'assistant',
  text: 'Try these.',
  about: null,
  proposals,
  created_at: null,
})

function renderCards(
  shown: ChatMessage = message(base, NEW),
  readOnly = false,
  onCheck: (messageId: number) => Promise<ChatMessage> = vi.fn(),
) {
  const onApply = vi.fn((_m: number, id: string) =>
    Promise.resolve({
      message: message(...(shown.proposals ?? []).map((p) => (p.id === id ? { ...p, state: 'applied' as const } : p))),
      updated: [] as ChatMessage[],
      stale: 0,
    }),
  )
  const onState = vi.fn((_m: number, id: string, state: 'pending' | 'dismissed') =>
    Promise.resolve(message(...(shown.proposals ?? []).map((p) => (p.id === id ? { ...p, state } : p)))),
  )
  const onUpdate = vi.fn()
  const announce = vi.fn()
  const onReply = vi.fn()
  const onFlag = vi.fn((_m: number, id: string, choice: FlagChoice) =>
    Promise.resolve(
      message(
        ...(shown.proposals ?? []).map((p) =>
          p.id === id && p.kind !== 'rule' ? { ...p, flags: p.flags?.map((flag) => (flag.rule === choice.rule ? { ...flag, dismissed: choice.dismissed } : flag)) } : p,
        ),
      ),
    ),
  )
  const view = render(
    <ProposalCards singular="resume"
      message={shown}
      sections={SECTIONS}
      readOnly={readOnly}
      onApply={onApply}
      onState={onState}
      onCheck={onCheck}
      onUpdate={onUpdate}
      announce={announce}
      onReply={onReply}
      onFlag={onFlag}
    />,
  )
  return { onApply, onState, onUpdate, announce, onReply, onFlag, view }
}

const drama = { kind: 'pattern' as const, rule: 'em dashes used for drama', quote: '—', why: 'It adds drama.' }

group('describe', () => {
  it('names each kind of change in a few words', () => {
    expect(describe(base, SECTIONS)).toBe('Reword the bullet "Shipped it" in Experience')
    expect(describe(NEW, SECTIONS)).toBe('Add new bullet in Experience')
    expect(describe({ ...base, action: 'add', target: 'experience', before: 'Engineer, Acme' }, SECTIONS)).toBe(
      'Add the role Engineer, Acme in Experience',
    )
    expect(describe({ ...base, action: 'remove', target: 'skill', before: 'React' }, SECTIONS)).toBe('Remove the skill React in Experience')
    expect(describe({ ...base, action: 'move', target: 'section', before: 'Projects', position: 1 }, SECTIONS)).toBe(
      'Move the Projects section to position 1',
    )
    expect(describe({ ...base, action: 'move', position: 0 }, SECTIONS)).toBe('Move the bullet "Shipped it" in Experience to the end')
    expect(describe({ ...base, section_id: 99 }, SECTIONS)).toBe('Reword the bullet "Shipped it" in a section')
  })

  it('names the category, role, or project a skill or bullet is under', () => {
    const entry = (kind: 'category' | 'experience' | 'project', item_id: number, values: Record<string, string>) => ({
      kind, row_id: item_id, item_id, position: 1, values, skills: [], bullets: [],
    })
    const sections: TreeSection[] = [
      { row_id: 1, section_id: 2, title: 'Skills', entries: [entry('category', 5, { category_name: 'Back End' })] },
      { row_id: 2, section_id: 3, title: 'Experience', entries: [entry('experience', 7, { role_title: 'Engineer', organization: 'Acme' })] },
      { row_id: 3, section_id: 4, title: 'Projects', entries: [entry('project', 9, { project_title: 'Tweaker' })] },
    ]
    const skill = { ...base, action: 'move' as const, target: 'skill' as const, section_id: 2, parent_kind: 'category' as const, parent_id: 5, before: 'Alembic' }
    expect(describe(skill, sections)).toBe('Move the skill Alembic in Back End to the end')
    expect(describe(base, sections)).toBe('Reword the bullet "Shipped it" in Engineer, Acme')
    expect(describe({ ...NEW, section_id: 4, parent_kind: 'project', parent_id: 9 }, sections)).toBe('Add new bullet in Tweaker')
    // Placed directly in a section, or its parent gone: the section.
    expect(describe({ ...base, parent_kind: '', parent_id: 0 }, sections)).toBe('Reword the bullet "Shipped it" in Experience')
    expect(describe({ ...skill, parent_id: 6 }, sections)).toBe('Move the skill Alembic in Skills to the end')
  })
})

group('ProposalCards', () => {
  it('says when a waiting change would take the document past its pages, and by how much', async () => {
    const page = { limit: 2, pages: 2.1, over_lines: 3, too_long: ['Experience'] }
    const { view } = renderCards(message({ ...base, page }, { ...NEW, page: { ...page, over_lines: 1, too_long: [] } }))
    const [first, second] = within(screen.getByRole('list', { name: 'Proposed changes' })).getAllByRole('listitem')
    expect(first).toHaveTextContent('Would take the resume 3 lines over 2 pages. Would make Experience too long for one page.')
    expect(second).toHaveTextContent('Would take the resume 1 line over 2 pages.')
    // Read with Apply too.
    expect(within(first).getByRole('button', { name: /^Apply: / })).toHaveAccessibleDescription(
      'Would take the resume 3 lines over 2 pages. Would make Experience too long for one page.',
    )
    expect(within(first).getByRole('button', { name: /^Dismiss: / })).not.toHaveAccessibleDescription()
    await expectNoA11yViolations()
    // Only while it's waiting, and a letter's one page.
    view.rerender(
      <ProposalCards
        singular="cover letter"
        message={message({ ...base, state: 'dismissed', page }, { ...NEW, page: { limit: 1, pages: 1.1, over_lines: 2, too_long: [] } })}
        sections={SECTIONS}
        readOnly={false}
        onApply={vi.fn()}
        onState={vi.fn()}
        onCheck={vi.fn()}
        onUpdate={vi.fn()}
        announce={vi.fn()}
        onReply={vi.fn()}
      />,
    )
    expect(screen.queryByText(/Would take the resume/)).not.toBeInTheDocument()
    expect(screen.getByText('Would take the cover letter 2 lines over 1 page.')).toBeInTheDocument()
  })

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
    // Nothing went stale, so nothing more is said.
    expect(announce).toHaveBeenLastCalledWith('Applied: Reword the bullet "Shipped it" in Experience.')
    await vi.waitFor(() => expect(document.getElementById('proposal-4-toolu_1')).toHaveFocus())
  })

  it('shows the earlier changes an apply set aside as stale, with Restore and Reply', async () => {
    const earlier: ChatMessage = { ...message({ ...base, id: 'toolu_7' }), message_id: 3 }
    const { onApply, onUpdate, announce, view } = renderCards()
    const setAside = { ...earlier, proposals: [{ ...base, id: 'toolu_7', state: 'stale' as const }] }
    onApply.mockResolvedValueOnce({ message: message({ ...base, state: 'applied' }, NEW), updated: [setAside], stale: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Apply: Reword the bullet "Shipped it" in Experience' }))
    await vi.waitFor(() =>
      expect(announce).toHaveBeenCalledWith('Applied: Reword the bullet "Shipped it" in Experience. 1 earlier change to the same content is now stale.'),
    )
    // Every message it changed is shown with its new state.
    expect(onUpdate.mock.calls.map(([changed]) => changed.message_id)).toEqual([4, 3])
    view.rerender(
      <ProposalCards singular="resume"
        message={setAside}
        sections={SECTIONS}
        readOnly={false}
        onApply={vi.fn()}
        onState={vi.fn()}
        onCheck={vi.fn()}
        onUpdate={vi.fn()}
        announce={vi.fn()}
        onReply={vi.fn()}
      />,
    )
    const card = document.getElementById('proposal-3-toolu_7')!
    expect(within(card).getByText('stale')).toHaveClass('tag')
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['Restore', 'Reply'])
    expect(within(card).getByRole('button', { name: 'Restore: Reword the bullet "Shipped it" in Experience' })).toBeInTheDocument()
    expect(within(card).getByText('Details', { exact: false, selector: 'summary > span' }).closest('details')).not.toHaveAttribute('open')
    await expectNoA11yViolations()
  })

  it('says how many earlier changes went stale', async () => {
    const { onApply, announce } = renderCards()
    onApply.mockResolvedValueOnce({ message: message({ ...base, state: 'applied' }, NEW), updated: [], stale: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Apply: Reword the bullet "Shipped it" in Experience' }))
    await vi.waitFor(() =>
      expect(announce).toHaveBeenCalledWith('Applied: Reword the bullet "Shipped it" in Experience. 2 earlier changes to the same content are now stale.'),
    )
  })

  it('dismisses a change, and restores it', async () => {
    const { onState, announce, view } = renderCards()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Add new bullet in Experience' }))
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Dismissed: Add new bullet in Experience.'))
    expect(onState).toHaveBeenCalledWith(4, 'toolu_2', 'dismissed')
    view.rerender(
      <ProposalCards singular="resume"
        message={message(base, { ...NEW, state: 'dismissed' })}
        sections={SECTIONS}
        readOnly={false}
        onApply={vi.fn()}
        onState={onState}
        onCheck={vi.fn()}
        onUpdate={vi.fn()}
        announce={announce}
        onReply={vi.fn()}
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

  it('replies to a change in any state, with its title and new text', async () => {
    const { onReply } = renderCards(message(base, { ...NEW, state: 'dismissed' }, { ...base, id: 'toolu_5', action: 'remove', new_text: '', state: 'applied' }))
    const [pending, dismissed, applied] = screen.getAllByRole('button', { name: /^Reply: / })
    expect(pending).toHaveTextContent('Reply')
    expect(pending).toHaveAccessibleName('Reply: Reword the bullet "Shipped it" in Experience')
    // Beside Apply and Dismiss, or Restore.
    expect(pending.previousElementSibling).toHaveTextContent('Dismiss')
    expect(dismissed.previousElementSibling).toHaveTextContent('Restore')
    fireEvent.click(pending)
    expect(onReply).toHaveBeenLastCalledWith({
      message_id: 4, proposal_id: 'toolu_1', label: 'Reword the bullet "Shipped it" in Experience', text: 'Shipped weekly.',
    })
    fireEvent.click(dismissed)
    expect(onReply).toHaveBeenLastCalledWith(expect.objectContaining({ proposal_id: 'toolu_2', text: 'Mentored two.' }))
    fireEvent.click(applied)
    expect(onReply).toHaveBeenLastCalledWith(expect.objectContaining({ proposal_id: 'toolu_5', text: '' }))
    await expectNoA11yViolations()
  })

  it('goes to each message that replied to a card, in a sent document too', async () => {
    render(
      <>
        <p id="chat-message-5" tabIndex={-1}>
          First reply
        </p>
        <p id="chat-message-8" tabIndex={-1}>
          Second reply
        </p>
        <ProposalCards singular="resume"
          message={message(base, NEW)}
          sections={SECTIONS}
          readOnly
          onApply={vi.fn()}
          onState={vi.fn()}
          onCheck={vi.fn()}
          onUpdate={vi.fn()}
          announce={vi.fn()}
          onReply={vi.fn()}
          repliesTo={(id) => (id === 'toolu_1' ? [5, 8] : id === 'toolu_2' ? [9] : [])}
        />
      </>,
    )
    const [first, second] = screen.getAllByRole('button', { name: /^Go to your reply \d to: Reword/ })
    expect([first.textContent, second.textContent]).toEqual(['Go to your reply 1', 'Go to your reply 2'])
    expect(first).toHaveAccessibleName('Go to your reply 1 to: Reword the bullet "Shipped it" in Experience')
    // One reply isn't numbered.
    expect(screen.getByRole('button', { name: 'Go to your reply to: Add new bullet in Experience' })).toHaveTextContent('Go to your reply')
    await expectNoA11yViolations()
    fireEvent.click(second)
    await vi.waitFor(() => expect(screen.getByText('Second reply')).toHaveFocus())
    fireEvent.click(first)
    await vi.waitFor(() => expect(screen.getByText('First reply')).toHaveFocus())
  })

  it('marks an applied change, with only Reply left and its details folded away', async () => {
    renderCards(message({ ...base, state: 'applied' }))
    expect(screen.getByText('applied')).toHaveClass('tag')
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Reply'])
    const summary = screen.getByText('Details', { exact: false, selector: 'summary > span' })
    expect(summary).toHaveTextContent('Details of Reword the bullet "Shipped it" in Experience')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    await expectNoA11yViolations()
    fireEvent.click(summary)
    expect(summary.closest('details')).toHaveAttribute('open')
    expect(screen.getByText('After').nextElementSibling).toHaveTextContent('Shipped weekly.')
    await expectNoA11yViolations()
  })

  it("folds away a dismissed change's details, keeping Restore", () => {
    renderCards(message({ ...NEW, state: 'dismissed' }))
    expect(screen.getByText('Details', { exact: false, selector: 'summary > span' }).closest('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Restore: Add new bullet in Experience' })).toBeInTheDocument()
  })

  it('has no details to fold away for a change without any', () => {
    renderCards(message({ ...base, action: 'remove', reason: '', state: 'applied' }))
    expect(screen.queryByText('Details', { exact: false, selector: 'summary > span' })).not.toBeInTheDocument()
  })

  it("only shows a sent document's cards", async () => {
    renderCards(message(base, { ...NEW, state: 'dismissed' }), true)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("names a new skill's name as one", async () => {
    renderCards(message({ ...NEW, target: 'skill', parent_kind: 'category', parent_id: 5, new_text: 'Alembic' }))
    expect(screen.getByText('New skill').nextElementSibling).toHaveTextContent('Alembic')
    expect(screen.getByRole('button', { name: 'Apply: Add new skill in Experience' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('shows nothing without proposals', () => {
    const { view } = renderCards(message())
    expect(view.container).toBeEmptyDOMElement()
  })
})

group('ProposalCards and the writing rules', () => {
  const SAVED: Proposal = { ...base, id: 'toolu_3', action: 'add', item_id: 9, new_text: '', before: 'Led a team — of five', reason: '' }

  it('badges a card whose text breaks a rule and lists each rule, for Claude’s text and a saved item', async () => {
    renderCards(message({ ...base, flags: [drama], checked: true }, { ...SAVED, flags: [drama], checked: true }, { ...NEW, checked: true }))
    // The cards themselves, not the lists of rules inside them.
    const [reword, saved, added] = Array.from(screen.getByRole('list', { name: 'Proposed changes' }).children) as HTMLElement[]
    expect(within(reword).getByText('Flagged')).toBeInTheDocument()
    // Read apart from the title, not run into it.
    expect(within(reword).getAllByRole('paragraph')[0]).toHaveTextContent('Reword the bullet "Shipped it" in Experience Flagged')
    expect(within(reword).getByRole('list', { name: 'Writing rules Reword the bullet "Shipped it" in Experience breaks' })).toHaveTextContent(
      'em dashes used for drama: “—”. It adds drama.',
    )
    expect(within(saved).getByText('Flagged')).toBeInTheDocument()
    expect(within(saved).getByRole('list', { name: /^Writing rules .* breaks$/ })).toBeInTheDocument()
    expect(within(added).queryByText('Flagged')).not.toBeInTheDocument()
    // Every card was checked, so nothing offers to check again.
    expect(screen.queryByRole('button', { name: 'Check writing rules again' })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('keeps the flags with the details once a card is applied', () => {
    renderCards(message({ ...base, flags: [drama], checked: true, state: 'applied' }))
    expect(screen.getByText('Flagged')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /^Writing rules/ })).not.toBeVisible()
  })

  it('says when the check failed, and checks again, announcing what it found and moving focus to the first card', async () => {
    const unchecked = message({ ...base, checked: false }, { ...base, id: 'toolu_4', action: 'remove', checked: true })
    const checked = message({ ...base, checked: true, flags: [drama] }, { ...base, id: 'toolu_4', action: 'remove', checked: true })
    const onCheck = vi.fn(() => Promise.resolve(checked))
    const { onUpdate, announce } = renderCards(unchecked, false, onCheck)
    expect(screen.getByText(/couldn't check this change against your writing rules, so nothing in it is flagged/)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Check writing rules again' })
    expect(button).toHaveAccessibleDescription(/couldn't check this change/)
    await expectNoA11yViolations()
    fireEvent.click(button)
    expect(button).toHaveTextContent('Checking…')
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Checked against your writing rules. 1 change breaks a rule, marked Flagged.'))
    expect(onCheck).toHaveBeenCalledWith(4)
    expect(onUpdate).toHaveBeenCalledWith(checked)
    await vi.waitFor(() => expect(document.getElementById('proposal-4-toolu_1')).toHaveFocus())
  })

  it('says when checking again finds nothing, and shows a failure with the button still there', async () => {
    const two = message({ ...base, checked: false }, { ...NEW, checked: false })
    const onCheck = vi
      .fn<(messageId: number) => Promise<ChatMessage>>()
      .mockRejectedValueOnce(new ApiError('AI_UNAVAILABLE', 'Claude is unavailable. Try again.', null, 503))
      .mockResolvedValueOnce(message({ ...base, checked: true }, { ...NEW, checked: true }))
    const { announce } = renderCards(two, false, onCheck)
    expect(screen.getByText(/couldn't check these 2 changes against your writing rules, so nothing in them is flagged/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Claude is unavailable. Try again.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Check writing rules again' }))
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Checked against your writing rules. Nothing breaks a rule.'))
  })

  it('shows a sent document’s unchecked note without the button, and leaves out applied cards', () => {
    renderCards(message({ ...base, checked: false }), true)
    expect(screen.getByText(/couldn't check this change/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check writing rules again' })).not.toBeInTheDocument()
  })

  it('has nothing to check again once the unchecked card is applied', () => {
    renderCards(message({ ...base, checked: false, state: 'applied' }))
    expect(screen.queryByText(/couldn't check/)).not.toBeInTheDocument()
  })
})

group('WaitingForYou', () => {
  const later: ChatMessage = { ...message({ ...base, id: 'toolu_3', action: 'remove', target: 'skill', before: 'React' }), message_id: 6 }

  function renderWaiting(messages: ChatMessage[]) {
    return render(
      <>
        <WaitingForYou messages={messages} sections={SECTIONS} />
        {messages.map((shown) => (
          <ProposalCards singular="resume"
            key={shown.message_id}
            message={shown}
            sections={SECTIONS}
            readOnly={false}
            onApply={vi.fn()}
            onState={vi.fn()}
            onCheck={vi.fn()}
            onUpdate={vi.fn()}
            announce={vi.fn()}
            onReply={vi.fn()}
          />
        ))}
      </>,
    )
  }

  const toggle = () => screen.getByRole('button', { name: /^Waiting for you/ })

  it('lists every change still waiting, oldest first, leaving out applied, dismissed, and stale ones', async () => {
    renderWaiting([
      message(base, { ...NEW, state: 'applied' }, { ...base, id: 'toolu_4', state: 'dismissed' }, { ...base, id: 'toolu_5', state: 'stale' }),
      later,
    ])
    const list = screen.getByRole('region', { name: 'Waiting for you (2)' })
    // Closed to start, under a heading that opens it.
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('heading', { level: 4, name: 'Waiting for you (2)' })).toContainElement(toggle())
    expect(within(list).queryByRole('button', { name: /^Go to/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(toggle())
    expect(within(list).getAllByRole('button', { name: /^Go to/ }).map((button) => button.textContent)).toEqual([
      'Reword the bullet "Shipped it" in Experience',
      'Remove the skill React in Experience',
    ])
    await expectNoA11yViolations()
  })

  it('stays open or closed as the user last left it', () => {
    const { unmount } = renderWaiting([message(base)])
    fireEvent.click(toggle())
    unmount()
    const again = renderWaiting([message(base)])
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle())
    again.unmount()
    renderWaiting([message(base)])
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('starts closed when the browser blocks storage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderWaiting([message(base)])
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    // Still opens.
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    getItem.mockRestore()
    setItem.mockRestore()
  })

  it('moves focus to the card it names', async () => {
    renderWaiting([message(base), later])
    fireEvent.click(toggle())
    fireEvent.click(screen.getByRole('button', { name: 'Go to: Remove the skill React in Experience' }))
    await vi.waitFor(() => expect(document.getElementById('proposal-6-toolu_3')).toHaveFocus())
  })

  it('shows nothing when nothing is waiting', () => {
    const { container } = render(<WaitingForYou messages={[message({ ...base, state: 'applied' })]} sections={SECTIONS} />)
    expect(container).toBeEmptyDOMElement()
  })
})

group('ProposalCards with a rule', () => {
  const BAN: AnyProposal = {
    kind: 'rule',
    id: 'toolu_3',
    action: 'add',
    target: 'banned',
    rule_id: 0,
    new_text: 'streamlined',
    reason: 'You called it nonsense.',
    before: '',
    tone_set_id: 0,
    tone_name: '',
    built_in: false,
    state: 'pending',
  }

  it("shows a rule's card among the others, and says what applying it did", async () => {
    const shown = message(base, BAN)
    const onApplyRule = vi.fn(() =>
      Promise.resolve({
        message: message(base, { ...BAN, state: 'applied' as const }),
        updated: [] as ChatMessage[],
        stale: 0,
        notice: 'Banned "streamlined".',
      }),
    )
    const announce = vi.fn()
    const onUpdate = vi.fn()
    render(
      <ProposalCards
        singular="resume"
        message={shown}
        sections={SECTIONS}
        readOnly={false}
        onApply={vi.fn()}
        onState={vi.fn()}
        onCheck={vi.fn()}
        onUpdate={onUpdate}
        announce={announce}
        onReply={vi.fn()}
        onApplyRule={onApplyRule}
      />,
    )
    const cards = screen.getByRole('list', { name: 'Proposed changes' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(2)
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Apply: Ban "streamlined"' }))
    await vi.waitFor(() =>
      expect(onApplyRule).toHaveBeenCalledWith(4, 'toolu_3', { apply_to: [], earlier_name: null, copy_name: null }),
    )
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Applied: Ban "streamlined". Banned "streamlined".'))
    expect(onUpdate).toHaveBeenCalled()
    await vi.waitFor(() => expect(document.getElementById('proposal-4-toolu_3')).toHaveFocus())
  })

  it("only shows a rule's card where rules can't be applied (the review's fixes)", () => {
    render(
      <ProposalCards
        singular="resume"
        message={message(BAN)}
        sections={SECTIONS}
        readOnly={false}
        onApply={vi.fn()}
        onState={vi.fn()}
        onCheck={vi.fn()}
        onUpdate={vi.fn()}
        announce={vi.fn()}
        onReply={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Apply: Ban "streamlined"' })).not.toBeInTheDocument()
  })
})

group('ProposalCards flags', () => {
  it("dismisses a card's writing flag, saying so in the panel", async () => {
    const { onFlag, onUpdate, announce } = renderCards(message({ ...base, flags: [drama], checked: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss flag "em dashes used for drama" on Reword the bullet "Shipped it" in Experience' }))
    await vi.waitFor(() =>
      expect(announce).toHaveBeenCalledWith('Dismissed the flag "em dashes used for drama" on Reword the bullet "Shipped it" in Experience.'),
    )
    expect(onFlag).toHaveBeenCalledWith(4, 'toolu_1', { kind: 'pattern', rule: 'em dashes used for drama', quote: '—', dismissed: true })
    expect(onUpdate.mock.calls.at(-1)![0].proposals[0].flags[0].dismissed).toBe(true)
  })

  it("leaves a sent document's flags as they are", () => {
    renderCards(message({ ...base, flags: [drama], checked: true }), true)
    expect(screen.getByRole('list', { name: 'Writing rules Reword the bullet "Shipped it" in Experience breaks' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Dismiss flag/ })).not.toBeInTheDocument()
  })
})
