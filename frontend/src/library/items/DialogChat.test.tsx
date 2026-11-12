import { fireEvent, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatAbout, ChatMessage } from '../../shared/api/chat'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
import DialogChat from './DialogChat'

const ABOUT: ChatAbout = {
  level: 'item',
  label: 'the bullet "Shipped it" under Engineer, Acme in Experience',
  section_id: 3,
  kind: 'bullet',
  item_id: 8,
  parent_kind: 'experience',
  parent_id: 7,
}

const turns = (proposals: ChatMessage['proposals']): ChatMessage[] => [
  { message_id: 1, role: 'user', text: 'Shorter?', about: ABOUT, proposals: null, created_at: null },
  { message_id: 2, role: 'assistant', text: 'Try this.', about: null, proposals, created_at: null },
]
const REWORD = {
  id: 'toolu_1',
  action: 'reword' as const,
  target: 'bullet' as const,
  section_id: 3,
  item_id: 8,
  parent_kind: 'experience' as const,
  parent_id: 7,
  new_text: 'Shipped weekly.',
  position: 0,
  reason: 'Shorter.',
  before: 'Shipped it',
  state: 'pending' as const,
}

// The reply, streamed as JSON lines.
function streamed(...lines: object[]) {
  return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(''), { status: 200 })
}

// The dialog's text field, kept as the item's view keeps it.
function Field() {
  const [value, setValue] = useState('Shipped it')
  return (
    <>
      <label>
        Bullet text
        <textarea value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <DialogChat field="content" value={value} onUse={setValue} />
    </>
  )
}

function stubSend(...replies: Response[]) {
  const fetchMock = stubApi({})
  fetchMock.mockImplementation(() => Promise.resolve(replies.shift()!))
  return fetchMock
}

const placed = (onSent = vi.fn()) => ({
  doc: 'resume',
  where: { kind: 'resume' as const, id: 5 },
  chat: { about: ABOUT, onSent },
})

describe('DialogChat', () => {
  it('asks Claude about the item with its unsaved text, and puts its wording in the field', async () => {
    const fetchMock = stubSend(streamed({ type: 'text', text: 'Try this.' }, { type: 'done', messages: turns([REWORD]) }))
    const onSent = vi.fn()
    const host = await renderItem(<Field />, placed(onSent))
    const toggle = screen.getByText('Ask Claude')
    // Closed to start.
    expect(toggle.closest('details')).not.toHaveAttribute('open')
    await expectNoA11yViolations()
    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('Bullet text'), { target: { value: 'Shipped it often' } })
    fireEvent.change(screen.getByLabelText('Message to Claude'), { target: { value: 'Shorter?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(host.say).toHaveBeenCalledWith('Claude is replying…')
    await vi.waitFor(() => expect(host.say).toHaveBeenLastCalledWith('Claude: Try this. Its wording is below, with Use this.'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/resumes/5/chat')
    expect(JSON.parse(init!.body as string)).toEqual({ text: 'Shorter?', about: { ...ABOUT, unsaved: { content: 'Shipped it often' } } })
    expect(onSent).toHaveBeenCalled()
    expect(screen.getByLabelText('Message to Claude')).toHaveValue('')
    const asked = screen.getByRole('list', { name: 'Asked here' })
    expect(within(asked).getAllByRole('listitem')).toHaveLength(2)
    await expectNoA11yViolations()

    fireEvent.click(screen.getByRole('button', { name: 'Use this wording: "Shipped weekly."' }))
    expect(screen.getByLabelText('Bullet text')).toHaveValue('Shipped weekly.')
    expect(host.say).toHaveBeenLastCalledWith("Claude's wording is in the field. Save keeps it.")
  })

  it("shows only Claude's wordings for this item", async () => {
    stubSend(streamed({ type: 'done', messages: turns([{ ...REWORD, item_id: 9 }]) }))
    const host = await renderItem(<Field />, placed())
    fireEvent.click(screen.getByText('Ask Claude'))
    fireEvent.change(screen.getByLabelText('Message to Claude'), { target: { value: 'Shorter?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await vi.waitFor(() => expect(host.say).toHaveBeenLastCalledWith('Claude: Try this.'))
    expect(screen.queryByRole('button', { name: /^Use this/ })).not.toBeInTheDocument()
  })

  it('shows the reply as it streams in', async () => {
    let finish!: () => void
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: 'text', text: 'Thinking it over' })}\n`))
        finish = () => {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: 'done', messages: turns([]) })}\n`))
          controller.close()
        }
      },
    })
    stubSend(new Response(body, { status: 200 }))
    await renderItem(<Field />, placed())
    fireEvent.click(screen.getByText('Ask Claude'))
    fireEvent.change(screen.getByLabelText('Message to Claude'), { target: { value: 'Shorter?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Thinking it over')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveAttribute('aria-disabled', 'true')
    await expectNoA11yViolations()
    finish()
    expect(await screen.findByText('Try this.')).toBeInTheDocument()
  })

  it('keeps the question when the reply fails, offering Retry', async () => {
    stubSend(streamed({ type: 'error', error: { code: 'AI_UNAVAILABLE', message: 'Claude is unavailable.', field: null } }))
    const host = await renderItem(<Field />, placed())
    fireEvent.click(screen.getByText('Ask Claude'))
    fireEvent.change(screen.getByLabelText('Message to Claude'), { target: { value: 'Shorter?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Claude is unavailable.')
    expect(screen.getByLabelText('Message to Claude')).toHaveValue('Shorter?')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(host.say).toHaveBeenLastCalledWith('')
    await expectNoA11yViolations()
  })

  it('is left out without a chat (opened from the library, or a sent document)', async () => {
    await renderItem(<Field />, { doc: 'resume', where: { kind: 'resume', id: 5 } })
    expect(screen.queryByText('Ask Claude')).not.toBeInTheDocument()
  })
})
