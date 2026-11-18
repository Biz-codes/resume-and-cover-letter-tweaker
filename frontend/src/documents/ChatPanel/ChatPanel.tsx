// The chat with Claude beside a resume or cover letter (docs/APP_FLOW.md, "Working with Claude at
// every level"), shown in the page's side panel (SidePanel), which holds its heading and Collapse,
// and for a posting's document shares it with the posting as tabs. One conversation per document,
// kept in the database and read again when the page opens. Each message says what it's about (the document, a section, or an item), which the page
// sets from the "Ask Claude" button that opened the panel, and which can be widened to the section
// or the whole document.
//
// Claude's reply shows as it's written. Screen readers hear "Claude is replying" when it starts,
// that its changes are being checked against the writing rules once it's written (when it proposes
// any with text), and the whole reply once it's done (with how many changes are flagged), from the
// panel's own live region, not every piece. A reply that
// fails saves nothing, and the message stays in the box, with Retry.
//
// Each card still waiting says whether it would take the document past its pages, against the
// document as it is now, so the conversation is read again whenever the page's `version` changes
// (the page includes the document's last change in it); when that changes how many cards are
// marked, it's announced, with what was just said when it comes right after.
//
// A sent document's conversation can be read, not added to. Claude's proposals show under its
// reply through `proposals` (ProposalCards), and the ones still waiting are listed above the
// message box through `waiting` (WaitingForYou), except in a sent one.
//
// A card's Reply (through `proposals`' `reply`) puts "Replying to:" with the card above the
// message box, read with the box, with Cancel reply; the message is sent with it, and shows it in
// the conversation. Reply on another card replaces it, and a failed send keeps it. The two ends
// link to each other: the card's title in "Replying to:" moves focus to the card, and the card
// lists the messages that replied to it (`proposals`' `repliesTo`), each moving focus to one.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { KINDS, type DocKind } from '../../shared/api/documents'
import { useFocusLater } from '../../shared/hooks/useFocusLater'
import { sendOnEnter } from '../../shared/hooks/sendOnEnter'
import { chatApi, markedOf, uncheckedOf, type ChatAbout, type ChatMessage, type ReplyTo } from '../../shared/api/chat'
import { cardId, messageId } from '../ProposalCards/describe'
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

// The proposal a message replies to: the card's title, which moves focus to the card, then its new
// text, if it has any, quoted.
function Replying({ replyTo, id, onGoTo }: { replyTo: ReplyTo; id?: string; onGoTo: () => void }) {
  return (
    <div id={id} className={styles.replyTo}>
      <p>
        <span className={styles.replyLabel}>Replying to:</span>{' '}
        <button type="button" className={styles.goTo} aria-label={`Go to: ${replyTo.label}`} onClick={onGoTo}>
          {replyTo.label}
        </button>
      </p>
      {replyTo.text && <blockquote>{replyTo.text}</blockquote>}
    </div>
  )
}

const CHECKING = 'Checking the proposed changes against your writing rules…'

// How many cards still waiting would take the document past its pages.
function markedNote(count: number, singular: string) {
  if (count === 0) return `No proposed change would take the ${singular} past its pages now.`
  return `${count === 1 ? '1 proposed change' : `${count} proposed changes`} would take the ${singular} past its pages.`
}

// A change the chat announces within this long of another is said with it, so neither replaces the
// other in the live region before it's read.
const TOGETHER_MS = 3000

// After a reply: how many changes it proposes, how many of them break a writing rule, whether
// the check couldn't run, and how many would take the document past its pages.
function proposalsNote(answer: ChatMessage, singular: string) {
  const proposals = answer.proposals ?? []
  if (proposals.length === 0) return ''
  const count = proposals.length === 1 ? '1 proposed change' : `${proposals.length} proposed changes`
  const flagged = proposals.filter((proposal) => proposal.flags?.length).length
  const unchecked = uncheckedOf(answer).length
  let note = ` ${count} below.`
  if (flagged) note += ` ${flagged === 1 ? '1 breaks' : `${flagged} break`} a writing rule, marked Flagged.`
  if (unchecked) note += ` ${unchecked === 1 ? '1 could' : `${unchecked} could`}n't be checked against your writing rules.`
  const marked = markedOf([answer]).length
  if (marked) note += ` ${marked === 1 ? '1 would' : `${marked} would`} take the ${singular} past its pages, as marked.`
  return note
}

export default function ChatPanel({
  kind,
  docId,
  locked,
  about,
  wider,
  onAbout,
  headingId,
  onAnnounce,
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
  // The side panel's heading (or the chat's tab), where focus goes when a sent one's chat opens.
  headingId: string
  // Where its announcements go (the side panel's live region, outside its tabs), in place of its own.
  onAnnounce?: (text: string) => void
  // Changes each time "Chat with Claude" or "Ask Claude" opens it, which moves focus to the message
  // box; 0 when it opened from its tab, which keeps focus.
  focusRequest: number
  // Changes when a question was asked from an item's dialog, or the document changed (which changes
  // whether each card would fit on its pages), so the conversation is read again.
  version?: number | string
  // Claude's proposals under a reply (ProposalCards), given a way to show the message's new
  // state, to say something in the panel's live region, and to reply to one of them.
  proposals?: (
    message: ChatMessage,
    helpers: {
      update: (next: ChatMessage) => void
      announce: (text: string) => void
      reply: (to: ReplyTo) => void
      // The user's messages that replied to one of this message's proposals, by id, oldest first.
      repliesTo: (proposalId: string) => number[]
    },
  ) => ReactNode
  // The proposals still waiting for the user, from the whole conversation (WaitingForYou).
  waiting?: (messages: ChatMessage[]) => ReactNode
}) {
  const { singular } = KINDS[kind]
  const api = chatApi(kind)
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [text, setText] = useState('')
  const [replying, setReplying] = useState<string | null>(null)
  // The reply is written and its proposals are being checked against the writing rules.
  const [checking, setChecking] = useState(false)
  const [sendError, setSendError] = useState<ApiError | null>(null)
  // The proposal the next message replies to.
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null)
  const [ownAnnouncement, setOwnAnnouncement] = useState('')
  // In the side panel, said outside its tabs (so it's heard while the posting's tab shows).
  const announceTo = onAnnounce ?? setOwnAnnouncement
  // What it said last and when, so a change in the page marks right after (an applied card's) is
  // said with it.
  const lastSaid = useRef({ text: '', at: 0 })
  const setAnnouncement = useCallback(
    (said: string) => {
      lastSaid.current = { text: said, at: Date.now() }
      announceTo(said)
    },
    [announceTo],
  )
  // How many waiting cards were marked when the conversation was last read; null before the first.
  const marked = useRef<number | null>(null)
  const focusLater = useFocusLater()
  const errorId = useId()
  const replyId = useId()

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const read = await chatApi(kind).list(docId)
      setMessages(read)
      setLoadError(null)
      // Read again after a change: say when it changed how many cards wouldn't fit.
      const count = markedOf(read).length
      if (marked.current !== null && count !== marked.current) {
        const note = markedNote(count, singular)
        const last = lastSaid.current
        setAnnouncement(last.text && Date.now() - last.at < TOGETHER_MS ? `${last.text} ${note}` : note)
      }
      marked.current = count
      return true
    } catch (error) {
      setLoadError(toApiError(error))
      return false
    }
  }, [kind, docId, singular, setAnnouncement])

  // Retry's alert goes once the conversation reads, so focus moves to the message box (a sent
  // one's heading) instead of staying on the removed button.
  async function retry() {
    if (await load()) focusLater(locked ? headingId : CHAT_INPUT_ID)
  }

  useEffect(() => {
    void load()
  }, [load, version])

  useEffect(() => {
    if (focusRequest) focusLater(locked ? headingId : CHAT_INPUT_ID)
  }, [focusRequest, focusLater, locked, headingId])

  async function send() {
    const message = text.trim()
    if (!message || replying !== null) return
    setSendError(null)
    setReplying('')
    setChecking(false)
    setAnnouncement('Claude is replying…')
    try {
      const saved = await api.send(
        docId,
        message,
        about,
        (piece) => setReplying((sofar) => (sofar ?? '') + piece),
        () => {
          setChecking(true)
          setAnnouncement(CHECKING)
        },
        replyTo,
      )
      // Without any of them already read again (the document changed while Claude replied).
      setMessages((current) => [
        ...(current ?? []).filter((message) => !saved.some((one) => one.message_id === message.message_id)),
        ...saved,
      ])
      marked.current = markedOf([...(messages ?? []), ...saved]).length
      setText('')
      setReplyTo(null)
      const answer = saved.at(-1)
      setAnnouncement(`Claude: ${answer?.text ?? ''}${answer ? proposalsNote(answer, singular) : ''}`)
    } catch (error) {
      setSendError(toApiError(error))
      setAnnouncement('')
    } finally {
      setReplying(null)
      setChecking(false)
    }
  }

  const update = (next: ChatMessage) =>
    setMessages((current) => current?.map((message) => (message.message_id === next.message_id ? next : message)) ?? null)

  // A card's Reply: the message box takes focus, with what it replies to read with it.
  const reply = (to: ReplyTo) => {
    setReplyTo(to)
    setAnnouncement(`Replying to: ${to.label}.`)
    focusLater(CHAT_INPUT_ID)
  }

  const cancelReply = () => {
    if (replyTo) setAnnouncement(`No longer replying to: ${replyTo.label}.`)
    setReplyTo(null)
    focusLater(CHAT_INPUT_ID)
  }

  const repliesTo = (message: ChatMessage) => (proposalId: string) =>
    (messages ?? [])
      .filter((turn) => turn.reply_to?.message_id === message.message_id && turn.reply_to.proposal_id === proposalId)
      .map((turn) => turn.message_id)
  const goToCard = (to: ReplyTo) => focusLater(cardId(to.message_id, to.proposal_id))

  const describedBy = [replyTo && replyId, sendError && errorId].filter(Boolean).join(' ') || undefined

  // A failed read after the document changed keeps the conversation shown (and focus where it
  // is), saying above it that its page marks may be out of date.
  const staleError = loadError && messages && (
    <div role="alert">
      <p>{loadError.message} The changes below may not say whether they still fit on the page.</p>
      <button type="button" onClick={() => void retry()}>
        Retry
      </button>
    </div>
  )

  let conversation: ReactNode
  if (loadError && !messages) {
    conversation = (
      <div role="alert">
        <p>{loadError.message}</p>
        <button type="button" onClick={() => void retry()}>
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
          // The user's messages take focus from a card they replied to (scrolling them into view).
          <li
            key={message.message_id}
            id={message.role === 'user' ? messageId(message.message_id) : undefined}
            tabIndex={message.role === 'user' ? -1 : undefined}
            className={message.role === 'user' ? styles.mine : styles.claude}
          >
            <p className={styles.who}>{message.role === 'user' ? 'You' : 'Claude'}</p>
            {message.role === 'user' && message.about?.label && <p className="muted">About {message.about.label}</p>}
            {message.role === 'user' && message.reply_to && <Replying replyTo={message.reply_to} onGoTo={() => goToCard(message.reply_to!)} />}
            <Paragraphs text={message.text} />
            {message.role === 'assistant' &&
              proposals?.(message, { update, announce: setAnnouncement, reply, repliesTo: repliesTo(message) })}
          </li>
        ))}
        {replying !== null && (
          <li className={styles.claude} aria-busy="true">
            <p className={styles.who}>Claude</p>
            {replying ? <Paragraphs text={replying} /> : <p className="muted">Replying…</p>}
            {checking && <p className="muted">{CHECKING}</p>}
          </li>
        )}
      </ol>
    )
  }

  return (
    <>
      {staleError}
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
          {replyTo && (
            <div className={styles.replying}>
              <Replying replyTo={replyTo} id={replyId} onGoTo={() => goToCard(replyTo)} />
              <button type="button" aria-label={`Cancel reply to: ${replyTo.label}`} onClick={cancelReply}>
                Cancel reply
              </button>
            </div>
          )}
          <label>
            Message to Claude
            <textarea
              id={CHAT_INPUT_ID}
              rows={3}
              value={text}
              aria-required="true"
              aria-invalid={sendError?.field === 'text' || undefined}
              aria-describedby={describedBy}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={sendOnEnter(() => void send())}
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
      {!onAnnounce && (
        <p aria-live="polite" className="visually-hidden">
          {ownAnnouncement}
        </p>
      )}
    </>
  )
}
