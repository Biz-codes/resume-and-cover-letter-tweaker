// A card for a change Claude proposed to the user's rules (backend/app/rule_proposals.py): a rule
// in the document's tone, or a banned word or phrase, under Claude's reply with the chat's other
// cards (ProposalCards). It shows the rule before and after and Claude's reason, with Apply,
// Dismiss, Restore, and Reply, like a change to the document.
//
// Apply asks first when the change reaches past this document, the way the tone's dialog does: a
// built-in tone can't change, so it asks the name of the user's own copy (which this document
// switches to); a tone other resumes or cover letters use asks which of them get the change
// (ApplyChoice), and when some don't, the name the earlier version keeps. The form opens in place
// of the buttons, with focus on its first field, and Cancel goes back to Apply. Otherwise, Apply
// makes the change right away. The page's Undo doesn't take back a rule (it changes the library,
// not the document); the Writing rules page or the tone's dialog does.
import { useId, useState, type FormEvent } from 'react'
import type { RuleChoice, RuleProposal } from '../../shared/api/chat'
import { toApiError, type ApiError } from '../../shared/api/client'
import { savesNewTone } from '../../shared/api/toneSets'
import type { Use } from '../../shared/api/usage'
import { useFocusLater } from '../../shared/hooks/useFocusLater'
import Collapsible from '../../library/Collapsible/Collapsible'
import ApplyChoice from '../../library/ApplyChoice'
import { messageId } from './describe'
import styles from './ProposalCards.module.css'

export default function RuleCard({
  proposal,
  title,
  idBase,
  singular,
  readOnly,
  uses,
  onApply,
  onState,
  onReply,
  replies = [],
}: {
  proposal: RuleProposal
  title: string
  // Makes the card's ids unique on the page.
  idBase: string
  // "resume" or "cover letter", for what the copy note says.
  singular: string
  readOnly: boolean
  // The other resumes and cover letters using the tone (not this one), sent ones too.
  uses: Use[]
  onApply: (choice: RuleChoice) => Promise<void>
  onState: (state: 'pending' | 'dismissed') => Promise<void>
  onReply?: () => void
  replies?: number[]
}) {
  const focusLater = useFocusLater()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [copyName, setCopyName] = useState(`${proposal.tone_name} (mine)`)
  const [earlierName, setEarlierName] = useState(`${proposal.tone_name} (earlier)`)
  const errorId = useId()
  const noteId = useId()
  const applyId = `${idBase}-apply`
  const firstFieldId = `${idBase}-first`
  const tone = proposal.target === 'tone'
  const asks = tone && (proposal.built_in || uses.length > 0)
  const newTone = tone && !proposal.built_in && savesNewTone(uses, applyTo)

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setBusy(false)
    }
  }

  const choice = (): RuleChoice => ({
    apply_to: applyTo.flatMap((use) => (use.kind === 'job_posting' ? [] : [{ kind: use.kind, id: use.id }])),
    earlier_name: newTone ? earlierName : null,
    copy_name: proposal.built_in ? copyName : null,
  })

  // Focus goes to the copy's name, or the first checkbox, which reads with the checklist's question.
  function openChoice() {
    setChoosing(true)
    setError(null)
    setTimeout(() => {
      const first = document.getElementById(firstFieldId)
      ;(first?.matches('input') ? first : first?.querySelector('input'))?.focus()
    })
  }

  function cancel() {
    setChoosing(false)
    setError(null)
    focusLater(applyId)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await run(() => onApply(choice()))
  }

  const invalid = (field: string) => ({
    'aria-invalid': error?.field === field,
    'aria-describedby': error?.field === field ? errorId : undefined,
  })

  const details = (
    <>
      <dl className={styles.change}>
        {proposal.action === 'reword' && (
          <>
            <dt>Before</dt>
            <dd>{proposal.before}</dd>
            <dt>After</dt>
            <dd>{proposal.new_text}</dd>
          </>
        )}
        {proposal.action === 'add' && (
          <>
            <dt>{tone ? 'New rule' : 'Banned'}</dt>
            <dd>{proposal.new_text}</dd>
          </>
        )}
        {proposal.action === 'remove' && (
          <>
            <dt>{tone ? 'Rule' : 'Banned'}</dt>
            <dd>{proposal.before}</dd>
          </>
        )}
      </dl>
      {proposal.reason && <p className="muted">{proposal.reason}</p>}
    </>
  )

  return (
    <>
      <p className={styles.title}>
        <strong>{title}</strong>
        {proposal.state !== 'pending' && <span className="tag">{proposal.state}</span>}
      </p>
      {proposal.state === 'pending' ? (
        details
      ) : (
        <Collapsible
          title={
            <>
              Details<span className="visually-hidden"> of {title}</span>
            </>
          }
        >
          {details}
        </Collapsible>
      )}
      {choosing && proposal.state === 'pending' && !readOnly ? (
        <form className="stacked-form" aria-label={`Apply: ${title}`} onSubmit={(event) => void submit(event)}>
          {proposal.built_in ? (
            <>
              <p className="note" id={noteId}>
                &quot;{proposal.tone_name}&quot; is built in, so this saves your own copy of it, with the change, for this {singular}.
              </p>
              <label>
                Name of your copy
                <input
                  id={firstFieldId}
                  value={copyName}
                  aria-required="true"
                  {...invalid('copy_name')}
                  aria-describedby={[noteId, error?.field === 'copy_name' ? errorId : null].filter(Boolean).join(' ')}
                  onChange={(event) => setCopyName(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <div id={firstFieldId}>
                <ApplyChoice uses={uses} others sentToo applyTo={applyTo} onChange={setApplyTo} />
              </div>
              {newTone && (
                <label>
                  Name of the earlier version, which the others keep
                  <input
                    value={earlierName}
                    aria-required="true"
                    {...invalid('earlier_name')}
                    onChange={(event) => setEarlierName(event.target.value)}
                  />
                </label>
              )}
            </>
          )}
          {error && (
            <p role="alert" id={errorId}>
              {error.message}
            </p>
          )}
          <div className="actions">
            {/* aria-disabled, not disabled, so a focused button keeps focus while it saves. */}
            {/* Named for the card, since another card's form can be open too. */}
            <button type="submit" aria-label={busy ? undefined : `Apply: ${title}`} aria-disabled={busy}>
              {busy ? 'Applying…' : 'Apply'}
            </button>
            <button type="button" aria-label={`Cancel: ${title}`} onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && <p role="alert">{error.message}</p>}
          {!readOnly && (
            <div className="actions">
              {proposal.state === 'pending' && (
                <>
                  <button
                    type="button"
                    id={applyId}
                    aria-label={`Apply: ${title}`}
                    aria-disabled={busy}
                    onClick={() => (asks ? openChoice() : void run(() => onApply(choice())))}
                  >
                    Apply
                  </button>
                  <button type="button" aria-label={`Dismiss: ${title}`} aria-disabled={busy} onClick={() => void run(() => onState('dismissed'))}>
                    Dismiss
                  </button>
                </>
              )}
              {(proposal.state === 'dismissed' || proposal.state === 'stale') && (
                <button type="button" aria-label={`Restore: ${title}`} aria-disabled={busy} onClick={() => void run(() => onState('pending'))}>
                  Restore
                </button>
              )}
              {onReply && (
                <button type="button" aria-label={`Reply: ${title}`} onClick={onReply}>
                  Reply
                </button>
              )}
            </div>
          )}
        </>
      )}
      {replies.length > 0 && (
        <div className="actions">
          {replies.map((id, index) => {
            const which = replies.length > 1 ? ` ${index + 1}` : ''
            return (
              <button key={id} type="button" aria-label={`Go to your reply${which} to: ${title}`} onClick={() => focusLater(messageId(id))}>
                Go to your reply{which}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
