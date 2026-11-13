// "Ask Claude" inside a bullet's or narrative content's dialog, opened from a row of a resume's or
// cover letter's tree (docs/APP_FLOW.md, "Working with Claude at every level"). The user asks
// about an edit without leaving it: the question goes with the row it's about and the field's
// unsaved text, and joins the document's one conversation, which the chat panel shows once the
// dialog closes (one modal never opens inside another).
//
// Claude's reply streams in, and is announced in the dialog's notice once it's done. A rewording
// Claude proposes for this item shows here with "Use this", which only puts it in the field, saved
// with the dialog's Save; the rest of Claude's proposals wait as cards in the chat panel. Its
// wording is checked against the writing rules before it's shown, as the cards are: what it still
// breaks is badged "Flagged" with each rule, and if the check failed, "Check writing rules again".
import { useId, useState } from 'react'
import { shortBullet } from '../../shared/api/bullets'
import { chatApi, type ChatAbout, type ChatMessage, type Proposal } from '../../shared/api/chat'
import { toApiError, type ApiError } from '../../shared/api/client'
import WritingFlags from '../../shared/components/WritingFlags/WritingFlags'
import { flagCount } from '../../shared/components/WritingFlags/flagCount'
import { useFocusLater } from '../../shared/hooks/useFocusLater'
import Collapsible from '../Collapsible/Collapsible'
import { useItemHost } from './itemHost'
import styles from './DialogChat.module.css'

const CHECKING = "Checking Claude's wording against your writing rules…"

// After the reply: whether Claude's wording breaks a writing rule, or couldn't be checked.
function wordingNote(wordings: Proposal[]) {
  const flags = wordings.flatMap((proposal) => proposal.flags ?? [])
  if (wordings.some((proposal) => !proposal.checked)) return " It couldn't be checked against your writing rules."
  return flags.length ? `${flagCount(flags)} It's marked Flagged.` : ''
}

// Claude's wording the writing check couldn't read, with "Check writing rules again". One button
// whose text changes, so it keeps focus while it checks.
function Unchecked({ busy, error, onCheck }: { busy: boolean; error: ApiError | null; onCheck: () => void }) {
  const noteId = useId()
  return (
    <div className={styles.unchecked}>
      <p id={noteId}>Claude couldn&apos;t check its wording against your writing rules, so nothing in it is flagged.</p>
      {error && <p role="alert">{error.message}</p>}
      <button type="button" aria-describedby={noteId} aria-disabled={busy} onClick={onCheck}>
        {busy ? 'Checking…' : 'Check writing rules again'}
      </button>
    </div>
  )
}

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
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  // "Check writing rules again": the message being checked, and a failure, by message.
  const [rechecking, setRechecking] = useState<number | null>(null)
  const [checkError, setCheckError] = useState<{ messageId: number; error: ApiError } | null>(null)
  const boxId = useId()
  const errorId = useId()
  const focusLater = useFocusLater()
  const wordingButtonId = (messageId: number, proposalId: string) => `${boxId}-use-${messageId}-${proposalId}`
  if (!chat || !where) return null
  const about: ChatAbout = chat.about

  async function send() {
    const message = text.trim()
    if (!message || replying !== null || !where || !chat) return
    setError(null)
    setReplying('')
    setChecking(false)
    host.say('Claude is replying…')
    try {
      const saved = await chatApi(where.kind).send(
        where.id,
        message,
        { ...about, unsaved: { [field]: value } },
        (piece) => setReplying((sofar) => (sofar ?? '') + piece),
        () => {
          setChecking(true)
          host.say(CHECKING)
        },
      )
      setExchange((current) => [...current, ...saved])
      setText('')
      chat.onSent()
      const answer = saved.at(-1)
      const wordings = answer ? ownWordings(answer) : []
      host.say(`Claude: ${answer?.text ?? ''}${wordings.length ? ` Its wording is below, with Use this.${wordingNote(wordings)}` : ''}`)
    } catch (caught) {
      setError(toApiError(caught))
      host.say('')
    } finally {
      setReplying(null)
      setChecking(false)
    }
  }

  async function checkAgain(message: ChatMessage) {
    if (rechecking !== null || !where || !chat) return
    setRechecking(message.message_id)
    setCheckError(null)
    try {
      const checked = await chatApi(where.kind).check(where.id, message.message_id)
      setExchange((current) => current.map((turn) => (turn.message_id === checked.message_id ? checked : turn)))
      chat.onSent()
      const flagged = ownWordings(checked).flatMap((proposal) => proposal.flags ?? [])
      // The button is gone, so focus moves to Claude's wording's "Use this".
      const first = ownWordings(checked)[0]
      if (first) focusLater(wordingButtonId(checked.message_id, first.id))
      host.say(`Checked Claude's wording against your writing rules.${flagged.length ? flagCount(flagged) : ' It breaks none.'}`)
    } catch (caught) {
      setCheckError({ messageId: message.message_id, error: toApiError(caught) })
    } finally {
      setRechecking(null)
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
                ownWordings(message).map((proposal) => {
                  const name = `"${shortBullet(proposal.new_text)}"`
                  return (
                    <div key={proposal.id} className={styles.wording}>
                      <p className={styles.who}>
                        Claude&apos;s wording
                        {proposal.flags?.length ? (
                          <>
                            {' '}
                            <span className="badge badge-flagged">Flagged</span>
                          </>
                        ) : null}
                      </p>
                      <p>{proposal.new_text}</p>
                      <WritingFlags flags={proposal.flags} name={name} />
                      <button
                        type="button"
                        id={wordingButtonId(message.message_id, proposal.id)}
                        aria-label={`Use this wording: ${name}`}
                        onClick={() => {
                          onUse(proposal.new_text)
                          host.say(`Claude's wording is in the field. Save keeps it.${flagCount(proposal.flags)}`)
                        }}
                      >
                        Use this
                      </button>
                    </div>
                  )
                })}
              {message.role === 'assistant' && ownWordings(message).some((proposal) => !proposal.checked) && (
                <Unchecked
                  busy={rechecking === message.message_id}
                  error={checkError?.messageId === message.message_id ? checkError.error : null}
                  onCheck={() => void checkAgain(message)}
                />
              )}
            </li>
          ))}
          {replying !== null && (
            <li aria-busy="true">
              <p className={styles.who}>Claude</p>
              <p>{replying || 'Replying…'}</p>
              {checking && <p>{CHECKING}</p>}
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
