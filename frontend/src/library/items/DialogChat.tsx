// "Ask Claude" inside a bullet's or narrative content's dialog, opened from a row of a resume's or
// cover letter's tree (docs/APP_FLOW.md, "Working with Claude at every level"). The user asks
// about an edit without leaving it: the question goes with the row it's about and the field's
// unsaved text, and joins the document's one conversation, which the chat panel shows once the
// dialog closes (one modal never opens inside another).
//
// Claude's reply streams in, and is announced in the dialog's notice once it's done. A rewording
// Claude proposes for this item shows here with "Use this", which only puts it in the field, saved
// with the dialog's Save; the rest of Claude's proposals wait as cards in the chat panel.
import { useId, useState } from 'react'
import { shortBullet } from '../../shared/api/bullets'
import { chatApi, type ChatAbout, type ChatMessage } from '../../shared/api/chat'
import { toApiError, type ApiError } from '../../shared/api/client'
import Collapsible from '../Collapsible/Collapsible'
import { useItemHost } from './itemHost'
import styles from './DialogChat.module.css'

export default function DialogChat({
  field,
  value,
  onUse,
}: {
  // The item's text field, whose unsaved value goes with each question.
  field: string
  value: string
  // Puts Claude's wording in the field.
  onUse: (text: string) => void
}) {
  const host = useItemHost()
  const chat = host.placed?.chat
  const where = host.placed?.where
  const [exchange, setExchange] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [replying, setReplying] = useState<string | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const boxId = useId()
  const errorId = useId()
  if (!chat || !where) return null
  const about: ChatAbout = chat.about

  async function send() {
    const message = text.trim()
    if (!message || replying !== null || !where || !chat) return
    setError(null)
    setReplying('')
    host.say('Claude is replying…')
    try {
      const saved = await chatApi(where.kind).send(
        where.id,
        message,
        { ...about, unsaved: { [field]: value } },
        (piece) => setReplying((sofar) => (sofar ?? '') + piece),
      )
      setExchange((current) => [...current, ...saved])
      setText('')
      chat.onSent()
      const answer = saved.at(-1)
      const wordings = answer ? ownWordings(answer) : []
      host.say(`Claude: ${answer?.text ?? ''}${wordings.length ? ' Its wording is below, with Use this.' : ''}`)
    } catch (caught) {
      setError(toApiError(caught))
      host.say('')
    } finally {
      setReplying(null)
    }
  }

  // Claude's rewordings of this item, the ones "Use this" can put in the field.
  function ownWordings(message: ChatMessage) {
    return (message.proposals ?? []).filter(
      (proposal) =>
        proposal.action === 'reword' &&
        proposal.target === about.kind &&
        proposal.item_id === about.item_id &&
        proposal.section_id === about.section_id,
    )
  }

  return (
    <Collapsible title="Ask Claude">
      {(exchange.length > 0 || replying !== null) && (
        <ol aria-label="Asked here" className={styles.messages}>
          {exchange.map((message) => (
            <li key={message.message_id}>
              <p className={styles.who}>{message.role === 'user' ? 'You' : 'Claude'}</p>
              <p>{message.text}</p>
              {message.role === 'assistant' &&
                ownWordings(message).map((proposal) => (
                  <div key={proposal.id} className={styles.wording}>
                    <p className={styles.who}>Claude&apos;s wording</p>
                    <p>{proposal.new_text}</p>
                    <button
                      type="button"
                      aria-label={`Use this wording: "${shortBullet(proposal.new_text)}"`}
                      onClick={() => {
                        onUse(proposal.new_text)
                        host.say("Claude's wording is in the field. Save keeps it.")
                      }}
                    >
                      Use this
                    </button>
                  </div>
                ))}
            </li>
          ))}
          {replying !== null && (
            <li aria-busy="true">
              <p className={styles.who}>Claude</p>
              <p>{replying || 'Replying…'}</p>
            </li>
          )}
        </ol>
      )}
      <div className="stacked-form">
        <label htmlFor={boxId}>Message to Claude</label>
        <textarea
          id={boxId}
          rows={2}
          value={text}
          aria-required="true"
          aria-invalid={error?.field === 'text' || undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setText(event.target.value)}
        />
        {error && (
          <p role="alert" id={errorId}>
            {error.message}
          </p>
        )}
        <div className="actions">
          {/* Not a form: it sits inside the item's own form. aria-disabled keeps focus here while
              Claude replies. */}
          <button type="button" aria-disabled={replying !== null || !text.trim()} onClick={() => void send()}>
            {replying !== null ? 'Sending…' : error ? 'Retry' : 'Send'}
          </button>
        </div>
      </div>
    </Collapsible>
  )
}
