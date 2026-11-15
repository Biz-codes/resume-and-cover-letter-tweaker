import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { errorBody, stubApi, stubPendingApi } from '../../test/stubApi'
import type { ChatAbout, ChatMessage } from '../../shared/api/chat'
import ChatPanel, { CHAT_INPUT_ID } from './ChatPanel'

const DOCUMENT: ChatAbout = { level: 'document', label: 'the whole resume' }
const SECTION: ChatAbout = { level: 'section', label: 'the Experience section', section_id: 3 }
const ROLE: ChatAbout = { level: 'item', label: 'the role Engineer, Acme in Experience', section_id: 3, kind: 'experience', item_id: 7 }

const asked = (id: number, text: string, about: ChatAbout = DOCUMENT): ChatMessage => ({
  message_id: id,
  role: 'user',
  text,
  about,
  proposals: null,
  created_at: null,
})
const answered = (id: number, text: string, proposals: ChatMessage['proposals'] = []): ChatMessage => ({
  message_id: id,
  role: 'assistant',
  text,
  about: null,
  proposals,
  created_at: null,
})
const PROPOSAL = {
  id: 'toolu_1',
  action: 'reword' as const,
  target: 'bullet' as const,
  section_id: 3,
  item_id: 8,
  parent_kind: 'experience' as const,
  parent_id: 7,
  new_text: 'Shipped it weekly.',
  position: 0,
  reason: 'Shorter.',
  before: 'Shipped it',
  state: 'pending' as const,
  checked: true,
}
const DRAMA = { kind: 'pattern' as const, rule: 'em dashes used for drama', quote: '—', why: 'It adds drama.' }

// A streamed reply whose lines are sent one at a time, so a test can check what shows between them.
function streamed() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(made) {
      controller = made
    },
  })
  const encoder = new TextEncoder()
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }),
    send: (line: object) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)),
    end: () => controller.close(),
  }
}

// The chat read back with `history`, and each message sent answered by the next of `replies`.
function stubChat(history: ChatMessage[], replies: (Response | (() => Response))[] = []) {
  const fetchMock = stubApi({ 'GET /api/resumes/5/chat': [{ status: 200, body: history }] })
  const listed = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const reply = replies.shift()!
      return Promise.resolve(typeof reply === 'function' ? reply() : reply)
    }
    return listed(url, init)
  })
  return fetchMock
}

function renderPanel(props: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const onAbout = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <ChatPanel
      kind="resume"
      docId={5}
      locked={false}
      about={DOCUMENT}
      wider={[]}
      onAbout={onAbout}
      onClose={onClose}
      focusRequest={1}
      {...props}
    />,
  )
  return { onAbout, onClose, view }
}

const announced = () => document.querySelector('[aria-live="polite"]')?.textContent

describe('ChatPanel', () => {
  it('says it is loading the conversation', async () => {
    stubPendingApi()
    renderPanel()
    expect(screen.getByText('Loading the conversation…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('offers Retry when the conversation fails to load', async () => {
    const fetchMock = stubApi({
      'GET /api/resumes/5/chat': [
        { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong.') },
        { status: 200, body: [] },
      ],
    })
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No messages yet.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows the saved conversation, with what each message was about, and moves focus to the box', async () => {
    stubChat([asked(1, 'Tighten the role.', ROLE), answered(2, 'Here is a tighter version.\n\nTake a look.')])
    renderPanel()
    const conversation = await screen.findByRole('list', { name: 'Conversation' })
    const [mine, claude] = within(conversation).getAllByRole('listitem')
    expect(mine).toHaveTextContent('YouAbout the role Engineer, Acme in ExperienceTighten the role.')
    expect(within(claude).getAllByRole('paragraph').map((p) => p.textContent)).toEqual([
      'Claude',
      'Here is a tighter version.',
      'Take a look.',
    ])
    expect(screen.getByRole('complementary', { name: 'Chat with Claude' })).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByLabelText('Message to Claude')).toHaveFocus())
    await expectNoA11yViolations()
  })

  it('streams the reply as it is written, announcing it once it is done', async () => {
    const reply = streamed()
    const fetchMock = stubChat([], [reply.response])
    renderPanel({ about: SECTION, wider: [DOCUMENT] })
    await screen.findByText('No messages yet.')
    expect(screen.getByText('About the Experience section')).toBeInTheDocument()
    const box = screen.getByLabelText('Message to Claude')
    fireEvent.change(box, { target: { value: '  Lead with the strongest role.  ' } })
    const send = screen.getByRole('button', { name: 'Send' })
    send.focus()
    fireEvent.click(send)

    expect(await screen.findByRole('button', { name: 'Sending…' })).toHaveAttribute('aria-disabled', 'true')
    expect(send).toHaveFocus()
    expect(announced()).toBe('Claude is replying…')
    expect(screen.getByText('Replying…')).toBeInTheDocument()
    await expectNoA11yViolations()
    const [, init] = fetchMock.mock.calls.find(([, call]) => call?.method === 'POST')!
    expect(JSON.parse(init!.body as string)).toEqual({ text: 'Lead with the strongest role.', about: SECTION })

    // Each piece shows as it comes, without being announced.
    reply.send({ type: 'text', text: 'Move Acme ' })
    expect(await screen.findByText('Move Acme')).toBeInTheDocument()
    reply.send({ type: 'text', text: 'up.' })
    expect(await screen.findByText('Move Acme up.')).toBeInTheDocument()
    expect(announced()).toBe('Claude is replying…')

    reply.send({
      type: 'done',
      messages: [asked(1, 'Lead with the strongest role.', SECTION), answered(2, 'Move Acme up.', [PROPOSAL])],
    })
    reply.end()
    await vi.waitFor(() => expect(announced()).toBe('Claude: Move Acme up. 1 proposed change below.'))
    expect(box).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true')
    expect(within(screen.getByRole('list', { name: 'Conversation' })).getAllByRole('listitem')).toHaveLength(2)
    await expectNoA11yViolations()
  })

  it('says when the changes are being checked against the writing rules, and how many are flagged', async () => {
    const reply = streamed()
    stubChat([], [reply.response])
    renderPanel()
    await screen.findByText('No messages yet.')
    fireEvent.change(screen.getByLabelText('Message to Claude'), { target: { value: 'Tighten it.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    reply.send({ type: 'text', text: 'Three changes.' })
    expect(await screen.findByText('Three changes.')).toBeInTheDocument()
    reply.send({ type: 'checking' })
    const conversation = screen.getByRole('list', { name: 'Conversation' })
    expect(await within(conversation).findByText('Checking the proposed changes against your writing rules…')).toBeInTheDocument()
    expect(announced()).toBe('Checking the proposed changes against your writing rules…')
    await expectNoA11yViolations()

    reply.send({
      type: 'done',
      messages: [
        asked(1, 'Tighten it.'),
        answered(2, 'Three changes.', [
          { ...PROPOSAL, flags: [DRAMA] },
          { ...PROPOSAL, id: 'toolu_2', flags: [DRAMA] },
          { ...PROPOSAL, id: 'toolu_3', checked: false },
        ]),
      ],
    })
    reply.end()
    await vi.waitFor(() =>
      expect(announced()).toBe(
        "Claude: Three changes. 3 proposed changes below. 2 break a writing rule, marked Flagged. 1 couldn't be checked against your writing rules.",
      ),
    )
    expect(within(screen.getByRole('list', { name: 'Conversation' })).queryByText(/^Checking/)).not.toBeInTheDocument()
  })

  it('says when the one flagged change breaks a rule', async () => {
    const reply = streamed()
    stubChat([], [reply.response])
    renderPanel()
    await screen.findByText('No messages yet.')
    fireEvent.change(screen.getByLabelText('Message to Claude'), { target: { value: 'Tighten it.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    reply.send({ type: 'done', messages: [asked(1, 'Tighten it.'), answered(2, 'One.', [{ ...PROPOSAL, flags: [DRAMA] }])] })
    reply.end()
    await vi.waitFor(() => expect(announced()).toBe('Claude: One. 1 proposed change below. 1 breaks a writing rule, marked Flagged.'))
  })

  it('keeps the message when the reply fails, offering Retry, and says nothing', async () => {
    const failed = () => {
      const reply = streamed()
      reply.send({ type: 'text', text: 'Half' })
      reply.send({ type: 'error', error: { code: 'AI_UNAVAILABLE', message: 'Claude is unavailable.', field: null } })
      reply.end()
      return reply.response
    }
    const fine = () => {
      const reply = streamed()
      reply.send({ type: 'done', messages: [asked(1, 'Hello'), answered(2, 'Hi.')] })
      reply.end()
      return reply.response
    }
    stubChat([], [failed, fine])
    renderPanel()
    await screen.findByText('No messages yet.')
    fireEvent.change(screen.getByLabelText('Message to Claude'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Claude is unavailable.')
    expect(screen.getByLabelText('Message to Claude')).toHaveValue('Hello')
    expect(screen.queryByText('Half')).not.toBeInTheDocument()
    expect(announced()).toBe('')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(announced()).toBe('Claude: Hi.'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('marks the box when the message is refused', async () => {
    stubChat([], [Response.json(errorBody('VALIDATION_FAILED', 'Write a message of up to 4,000 characters.', 'text'), { status: 422 })])
    renderPanel()
    await screen.findByText('No messages yet.')
    const box = screen.getByLabelText('Message to Claude')
    fireEvent.change(box, { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Write a message of up to 4,000 characters.')
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription('Write a message of up to 4,000 characters.')
    await expectNoA11yViolations()
  })

  it('sends on Enter, and starts a new line on Shift+Enter or while composing', async () => {
    const fine = () => {
      const reply = streamed()
      reply.send({ type: 'done', messages: [asked(1, 'Hello'), answered(2, 'Hi.')] })
      reply.end()
      return reply.response
    }
    const fetchMock = stubChat([], [fine])
    renderPanel()
    await screen.findByText('No messages yet.')
    const box = screen.getByLabelText('Message to Claude')
    fireEvent.change(box, { target: { value: 'Hello' } })
    const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length
    // Shift+Enter, or Enter finishing an input method's word, is left to the box.
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(box, { key: 'Enter', isComposing: true })).toBe(true)
    expect(posts()).toBe(0)
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false)
    await vi.waitFor(() => expect(announced()).toBe('Claude: Hi.'))
    expect(posts()).toBe(1)
  })

  it('sends nothing while the box is empty', async () => {
    const fetchMock = stubChat([])
    renderPanel()
    await screen.findByText('No messages yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('widens what the message is about, and closes', async () => {
    stubChat([])
    const { onAbout, onClose } = renderPanel({ about: ROLE, wider: [SECTION, DOCUMENT] })
    await screen.findByText('No messages yet.')
    expect(screen.getByText('About the role Engineer, Acme in Experience')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ask about the Experience section instead' }))
    expect(onAbout).toHaveBeenCalledWith(SECTION)
    fireEvent.click(screen.getByRole('button', { name: 'Ask about the whole resume instead' }))
    expect(onAbout).toHaveBeenLastCalledWith(DOCUMENT)
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('moves focus to the box again each time it is asked to', async () => {
    stubChat([])
    const { view } = renderPanel()
    await vi.waitFor(() => expect(document.getElementById(CHAT_INPUT_ID)).toHaveFocus())
    screen.getByRole('button', { name: 'Close chat' }).focus()
    view.rerender(
      <ChatPanel kind="resume" docId={5} locked={false} about={SECTION} wider={[]} onAbout={vi.fn()} onClose={vi.fn()} focusRequest={2} />,
    )
    await vi.waitFor(() => expect(document.getElementById(CHAT_INPUT_ID)).toHaveFocus())
  })

  it("shows a sent one's conversation only, with focus on its heading", async () => {
    stubChat([asked(1, 'Hello'), answered(2, 'Hi.')])
    renderPanel({ locked: true })
    await screen.findByRole('list', { name: 'Conversation' })
    expect(screen.getByText('This resume was sent, so its conversation can be read but not added to.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Message to Claude')).not.toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Chat with Claude' })).toHaveFocus())
    await expectNoA11yViolations()
  })

  it("shows Claude's proposals under its reply", async () => {
    stubChat([asked(1, 'Hello'), answered(2, 'Try this.', [PROPOSAL])])
    renderPanel({ proposals: (message) => <p>{message.proposals?.length} cards</p> })
    expect(await screen.findByText('1 cards')).toBeInTheDocument()
  })

  it('lists what is waiting above the message box, from the whole conversation', async () => {
    stubChat([asked(1, 'Hello'), answered(2, 'Try this.', [PROPOSAL]), asked(3, 'And skills?'), answered(4, 'They look fine.')])
    renderPanel({ waiting: (messages) => <p>{messages.length} messages checked</p> })
    const waiting = await screen.findByText('4 messages checked')
    // After the conversation, before the message box, in reading and tab order.
    const conversation = screen.getByRole('list', { name: 'Conversation' })
    const box = screen.getByLabelText('Message to Claude')
    expect(conversation.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(waiting.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await expectNoA11yViolations()
  })

  describe('replying to a proposal', () => {
    const REPLY = { message_id: 2, proposal_id: 'toolu_1', label: 'Reword the bullet "Shipped it" in Experience', text: 'Shipped it weekly.' }
    const OTHER = { message_id: 2, proposal_id: 'toolu_2', label: 'Remove the skill React in Experience', text: '' }
    // A stand-in for the cards: a Reply button for each.
    const cards: Parameters<typeof ChatPanel>[0]['proposals'] = (_message, { reply }) => (
      <>
        <button type="button" onClick={() => reply(REPLY)}>
          Reply one
        </button>
        <button type="button" onClick={() => reply(OTHER)}>
          Reply two
        </button>
      </>
    )

    it('puts the proposal above the box, read with it, and cancels it', async () => {
      stubChat([asked(1, 'Hello'), answered(2, 'Try this.', [PROPOSAL])])
      renderPanel({ proposals: cards })
      fireEvent.click(await screen.findByRole('button', { name: 'Reply one' }))
      const box = screen.getByLabelText('Message to Claude')
      await vi.waitFor(() => expect(box).toHaveFocus())
      expect(box).toHaveAccessibleDescription('Replying to: Reword the bullet "Shipped it" in Experience Shipped it weekly.')
      expect(screen.getByText('Shipped it weekly.', { selector: 'blockquote' })).toBeInTheDocument()
      expect(announced()).toBe('Replying to: Reword the bullet "Shipped it" in Experience.')
      // Above the box, in reading and tab order.
      const cancel = screen.getByRole('button', { name: 'Cancel reply to: Reword the bullet "Shipped it" in Experience' })
      expect(cancel).toHaveTextContent('Cancel reply')
      expect(cancel.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      await expectNoA11yViolations()

      // Another card's Reply replaces it; one with no new text shows only its title.
      fireEvent.click(screen.getByRole('button', { name: 'Reply two' }))
      expect(box).toHaveAccessibleDescription('Replying to: Remove the skill React in Experience')
      expect(screen.queryByText('Shipped it weekly.', { selector: 'blockquote' })).not.toBeInTheDocument()
      await expectNoA11yViolations()

      cancel.focus()
      fireEvent.click(screen.getByRole('button', { name: /^Cancel reply/ }))
      expect(screen.queryByText('Replying to:')).not.toBeInTheDocument()
      expect(box).not.toHaveAccessibleDescription()
      expect(announced()).toBe('No longer replying to: Remove the skill React in Experience.')
      await vi.waitFor(() => expect(box).toHaveFocus())
    })

    it('sends the reply with the message, shows it in the conversation, and clears it', async () => {
      const reply = streamed()
      const fetchMock = stubChat([asked(1, 'Hello'), answered(2, 'Try this.', [PROPOSAL])], [reply.response])
      renderPanel({ proposals: cards })
      fireEvent.click(await screen.findByRole('button', { name: 'Reply one' }))
      fireEvent.change(screen.getByLabelText('Message to Claude'), { target: { value: 'Why weekly?' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      await screen.findByRole('button', { name: 'Sending…' })
      const [, init] = fetchMock.mock.calls.find(([, call]) => call?.method === 'POST')!
      expect(JSON.parse(init!.body as string)).toEqual({
        text: 'Why weekly?',
        about: DOCUMENT,
        reply_to: { message_id: 2, proposal_id: 'toolu_1', label: REPLY.label },
      })
      reply.send({ type: 'done', messages: [{ ...asked(3, 'Why weekly?'), reply_to: REPLY }, answered(4, 'It reads tighter.')] })
      reply.end()
      await vi.waitFor(() => expect(announced()).toBe('Claude: It reads tighter.'))
      expect(screen.queryByRole('button', { name: /^Cancel reply/ })).not.toBeInTheDocument()
      const [, , mine] = within(screen.getByRole('list', { name: 'Conversation' })).getAllByRole('listitem')
      expect(mine).toHaveTextContent('YouAbout the whole resumeReplying to: Reword the bullet "Shipped it" in ExperienceShipped it weekly.Why weekly?')
      await expectNoA11yViolations()
    })

    it('keeps the reply when sending fails', async () => {
      stubChat([asked(1, 'Hello'), answered(2, 'Try this.', [PROPOSAL])], [
        Response.json(errorBody('VALIDATION_FAILED', "That proposed change isn't in this chat. Reply to one shown above.", 'reply_to'), { status: 422 }),
      ])
      renderPanel({ proposals: cards })
      fireEvent.click(await screen.findByRole('button', { name: 'Reply one' }))
      fireEvent.change(screen.getByLabelText('Message to Claude'), { target: { value: 'Why weekly?' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(await screen.findByRole('alert')).toHaveTextContent("That proposed change isn't in this chat.")
      const box = screen.getByLabelText('Message to Claude')
      expect(box).toHaveValue('Why weekly?')
      // Read with the box: what it replies to, then the error.
      expect(box).toHaveAccessibleDescription(/^Replying to: Reword the bullet .*That proposed change isn't in this chat/)
      expect(screen.getByRole('button', { name: /^Cancel reply/ })).toBeInTheDocument()
      await expectNoA11yViolations()
    })

    it('shows what a saved message replied to, linking each end to the other', async () => {
      stubChat([asked(1, 'Hello'), answered(2, 'Try this.', [PROPOSAL]), { ...asked(3, 'And this?'), reply_to: OTHER }, answered(4, 'Sure.')])
      // A stand-in card, with the replies the panel finds for it.
      const card: Parameters<typeof ChatPanel>[0]['proposals'] = (message, { repliesTo }) =>
        message.message_id === 2 && (
          <div id="proposal-2-toolu_2" tabIndex={-1}>
            Card, replied to by {repliesTo('toolu_2').join(', ')}; {repliesTo('toolu_1').length} for the other
          </div>
        )
      // In a sent one's read-only chat too.
      renderPanel({ locked: true, proposals: card })
      const conversation = await screen.findByRole('list', { name: 'Conversation' })
      const mine = within(conversation).getAllByRole('listitem')[2]
      expect(mine).toHaveTextContent('YouAbout the whole resumeReplying to: Remove the skill React in ExperienceAnd this?')
      expect(within(mine).queryByRole('blockquote')).not.toBeInTheDocument()
      expect(screen.getByText(/^Card, replied to by/)).toHaveTextContent('Card, replied to by 3; 0 for the other')
      await expectNoA11yViolations()
      fireEvent.click(within(mine).getByRole('button', { name: 'Go to: Remove the skill React in Experience' }))
      await vi.waitFor(() => expect(document.getElementById('proposal-2-toolu_2')).toHaveFocus())
      // The user's messages take focus, so a card can go to them.
      expect(mine).toHaveAttribute('id', 'chat-message-3')
      expect(mine).toHaveAttribute('tabindex', '-1')
    })

    it('goes to the card from the reply above the box', async () => {
      stubChat([asked(1, 'Hello'), answered(2, 'Try this.', [PROPOSAL])])
      renderPanel({
        proposals: (message, helpers) => (
          <div id="proposal-2-toolu_1" tabIndex={-1}>
            {cards(message, helpers)}
          </div>
        ),
      })
      fireEvent.click(await screen.findByRole('button', { name: 'Reply one' }))
      fireEvent.click(screen.getByRole('button', { name: 'Go to: Reword the bullet "Shipped it" in Experience' }))
      await vi.waitFor(() => expect(document.getElementById('proposal-2-toolu_1')).toHaveFocus())
      await expectNoA11yViolations()
    })
  })

  it("lists nothing waiting in a sent one's conversation", async () => {
    stubChat([asked(1, 'Hello'), answered(2, 'Try this.', [PROPOSAL])])
    const waiting = vi.fn(() => <p>waiting</p>)
    renderPanel({ locked: true, waiting })
    await screen.findByRole('list', { name: 'Conversation' })
    expect(waiting).not.toHaveBeenCalled()
  })
})
