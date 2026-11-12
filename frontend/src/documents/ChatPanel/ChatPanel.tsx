// The chat with Claude beside a resume or cover letter (docs/APP_FLOW.md, "Working with Claude at
// every level"). One conversation per document, kept in the database and read again when the page
// opens. Each message says what it's about (the document, a section, or an item), which the page
// sets from the "Ask Claude" button that opened the panel, and which can be widened to the section
// or the whole document.
//
// Claude's reply shows as it's written. Screen readers hear "Claude is replying" when it starts and
// the whole reply once it's done, from the panel's own live region, not every piece. A reply that
// fails saves nothing, and the message stays in the box, with Retry.
//
// A sent document's conversation can be read, not added to. Claude's proposals show under its
// reply through `proposals` (ProposalCards), and the ones still waiting are listed above the
// message box through `waiting` (WaitingForYou), except in a sent one.
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { KINDS, type DocKind } from '../../shared/api/documents'
import { useFocusLater } from '../../shared/hooks/useFocusLater'
import { chatApi, type ChatAbout, type ChatMessage } from '../../shared/api/chat'
import styles from './ChatPanel.module.css'

export const CHAT_INPUT_ID = 'chat-message'

// Each paragraph of a message on its own line, as written.
function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n+/)
        .filter((line) => line.trim())
        .map((line, index) => (
          <p key={index}>{line}</p>
        ))}
    </>
  )
}

const pending = (count: number) => (count === 1 ? '1 proposed change' : `${count} proposed changes`)

export default function ChatPanel({
  kind,
  docId,
  locked,
  about,
  wider,
  onAbout,
  onClose,
  focusRequest,
  version = 0,
  proposals,
  waiting,
}: {
  kind: DocKind
  docId: number
  // Sent: the conversation is only shown.
  locked: boolean
  // What the next message is about, with its label.
  about: ChatAbout
  // What it can be widened to (the section, then the whole document), nearest first.
  wider: ChatAbout[]
  onAbout: (about: ChatAbout) => void
  onClose: () => void
  // Changes each time "Ask Claude" opens the panel, which moves focus to the message box.
  focusRequest: number
  // Changes when a question was asked from an item's dialog, so the conversation is read again.
  version?: number
  // Claude's proposals under a reply (ProposalCards), given a way to show the message's new
  // state and to say something in the panel's live region.
  proposals?: (message: ChatMessage, helpers: { update: (next: ChatMessage) => void; announce: (text: string) => void }) => ReactNode
  // The proposals still waiting for the user, from the whole conversation (WaitingForYou).
  waiting?: (messages: ChatMessage[]) => ReactNode
}) {
  const { singular } = KINDS[kind]
  const api = chatApi(kind)
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [text, setText] = useState('')
  const [replying, setReplying] = useState<string | null>(null)
  const [sendError, setSendError] = useState<ApiError | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const focusLater = useFocusLater()
  const headingId = useId()
  const errorId = useId()

  const load = useCallback(async () => {
    try {
      setMessages(await chatApi(kind).list(docId))
      setLoadError(null)
    } catch (error) {
      setLoadError(toApiError(error))
    }
  }, [kind, docId])

  useEffect(() => {
    void load()
  }, [load, version])

  useEffect(() => {
    focusLater(locked ? headingId : CHAT_INPUT_ID)
  }, [focusRequest, focusLater, locked, headingId])

  async function send() {
    const message = text.trim()
    if (!message || replying !== null) return
    setSendError(null)
    setReplying('')
    setAnnouncement('Claude is replying…')
    try {
      const saved = await api.send(docId, message, about, (piece) => setReplying((sofar) => (sofar ?? '') + piece))
      setMessages((current) => [...(current ?? []), ...saved])
      setText('')
      const answer = saved.at(-1)
      const count = answer?.proposals?.length ?? 0
      setAnnouncement(`Claude: ${answer?.text ?? ''}${count ? ` ${pending(count)} below.` : ''}`)
    } catch (error) {
      setSendError(toApiError(error))
      setAnnouncement('')
    } finally {
      setReplying(null)
    }
  }

  const update = (next: ChatMessage) =>
    setMessages((current) => current?.map((message) => (message.message_id === next.message_id ? next : message)) ?? null)

  let conversation: ReactNode
  if (loadError) {
    conversation = (
      <div role="alert">
        <p>{loadError.message}</p>
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  } else if (!messages) {
    conversation = <p>Loading the conversation…</p>
  } else if (messages.length === 0 && replying === null) {
    conversation = <p className="muted">No messages yet.</p>
  } else {
    conversation = (
      <ol aria-label="Conversation" className={styles.messages}>
        {messages.map((message) => (
          <li key={message.message_id} className={message.role === 'user' ? styles.mine : styles.claude}>
            <p className={styles.who}>{message.role === 'user' ? 'You' : 'Claude'}</p>
            {message.role === 'user' && message.about?.label && <p className="muted">About {message.about.label}</p>}
            <Paragraphs text={message.text} />
            {message.role === 'assistant' && proposals?.(message, { update, announce: setAnnouncement })}
          </li>
        ))}
        {replying !== null && (
          <li className={styles.claude} aria-busy="true">
            <p className={styles.who}>Claude</p>
            {replying ? <Paragraphs text={replying} /> : <p className="muted">Replying…</p>}
          </li>
        )}
      </ol>
    )
  }

  return (
    <aside className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.top}>
        <h3 id={headingId} tabIndex={-1}>
          Chat with Claude
        </h3>
        <button type="button" onClick={onClose}>
          Close chat
        </button>
      </div>
      {conversation}
      {/* Above the message box, where the user is after a reply, since the conversation above
          scrolls out of view as it grows. */}
      {!locked && messages && waiting?.(messages)}
      {locked ? (
        <p className="muted">This {singular} was sent, so its conversation can be read but not added to.</p>
      ) : (
        <form
          className="stacked-form"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <div className={styles.about}>
            <p>About {about.label}</p>
            {wider.map((option) => (
              <button key={option.level} type="button" onClick={() => onAbout(option)}>
                Ask about {option.label} instead
              </button>
            ))}
          </div>
          <label>
            Message to Claude
            <textarea
              id={CHAT_INPUT_ID}
              rows={3}
              value={text}
              aria-required="true"
              aria-invalid={sendError?.field === 'text' || undefined}
              aria-describedby={sendError ? errorId : undefined}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {sendError && (
            <div role="alert" id={errorId}>
              <p>{sendError.message}</p>
            </div>
          )}
          <div className="actions">
            {/* aria-disabled, not disabled, so a focused button keeps focus while Claude replies. */}
            <button type="submit" aria-disabled={replying !== null || !text.trim()}>
              {replying !== null ? 'Sending…' : sendError ? 'Retry' : 'Send'}
            </button>
          </div>
        </form>
      )}
      {/* A plain live region rather than role="status", so the page's notices stay in AlertDialog. */}
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
    </aside>
  )
}
