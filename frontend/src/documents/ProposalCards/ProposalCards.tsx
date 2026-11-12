// Claude's proposed changes under its reply in the chat (ChatPanel), one card each: what it
// changes, before and after, and Claude's reason, with Apply and Dismiss. Applying makes an
// ordinary change to the document (backend/app/proposals.py), which the page's Undo takes back;
// Claude's new or reworded text becomes a new library row used in this document only. A dismissed
// card can be restored. Each change is announced in the panel's live region, and focus stays on
// the card.
import { useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import type { TreeSection } from '../../shared/api/documents'
import { useFocusLater } from '../../shared/hooks/useFocusLater'
import type { ChatMessage, Proposal } from '../../shared/api/chat'
import { describe } from './describe'
import styles from './ProposalCards.module.css'

function Card({
  proposal,
  title,
  readOnly,
  onApply,
  onState,
}: {
  proposal: Proposal
  title: string
  readOnly: boolean
  onApply: () => Promise<void>
  onState: (state: 'pending' | 'dismissed') => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

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

  return (
    <>
      <p className={styles.title}>
        <strong>{title}</strong>
        {proposal.state !== 'pending' && <span className="tag">{proposal.state}</span>}
      </p>
      {proposal.action === 'reword' && (
        <dl className={styles.change}>
          <dt>Before</dt>
          <dd>{proposal.before}</dd>
          <dt>After</dt>
          <dd>{proposal.new_text}</dd>
        </dl>
      )}
      {proposal.action === 'add' && proposal.item_id === 0 && (
        <dl className={styles.change}>
          <dt>New text</dt>
          <dd>{proposal.new_text}</dd>
        </dl>
      )}
      {proposal.reason && <p className="muted">{proposal.reason}</p>}
      {error && <p role="alert">{error.message}</p>}
      {!readOnly && proposal.state === 'pending' && (
        <div className="actions">
          {/* aria-disabled, not disabled, so a focused button keeps focus while it saves. */}
          <button type="button" aria-label={`Apply: ${title}`} aria-disabled={busy} onClick={() => void run(onApply)}>
            Apply
          </button>
          <button type="button" aria-label={`Dismiss: ${title}`} aria-disabled={busy} onClick={() => void run(() => onState('dismissed'))}>
            Dismiss
          </button>
        </div>
      )}
      {!readOnly && proposal.state === 'dismissed' && (
        <div className="actions">
          <button type="button" aria-label={`Restore: ${title}`} aria-disabled={busy} onClick={() => void run(() => onState('pending'))}>
            Restore
          </button>
        </div>
      )}
    </>
  )
}

export default function ProposalCards({
  message,
  sections,
  readOnly,
  onApply,
  onState,
  onUpdate,
  announce,
}: {
  message: ChatMessage
  // The document's sections, which name where each change is.
  sections: TreeSection[]
  // A sent document: the cards are only shown.
  readOnly: boolean
  // Makes the change and returns the message with its new state.
  onApply: (messageId: number, proposalId: string) => Promise<ChatMessage>
  onState: (messageId: number, proposalId: string, state: 'pending' | 'dismissed') => Promise<ChatMessage>
  // Shows the message's new state in the conversation.
  onUpdate: (message: ChatMessage) => void
  // Says something in the panel's live region.
  announce: (text: string) => void
}) {
  const focusLater = useFocusLater()
  const proposals = message.proposals ?? []
  if (proposals.length === 0) return null
  const sectionTitle = (id: number) => sections.find((section) => section.section_id === id)?.title ?? 'a section'
  const cardId = (proposal: Proposal) => `proposal-${message.message_id}-${proposal.id}`

  return (
    <ul aria-label="Proposed changes" className={styles.cards}>
      {proposals.map((proposal) => {
        const title = describe(proposal, sectionTitle)
        return (
          <li key={proposal.id} id={cardId(proposal)} tabIndex={-1} className={styles.card}>
            <Card
              proposal={proposal}
              title={title}
              readOnly={readOnly}
              onApply={async () => {
                onUpdate(await onApply(message.message_id, proposal.id))
                announce(`Applied: ${title}.`)
                // Its buttons are gone, so focus stays on the card.
                focusLater(cardId(proposal))
              }}
              onState={async (state) => {
                onUpdate(await onState(message.message_id, proposal.id, state))
                announce(state === 'dismissed' ? `Dismissed: ${title}.` : `Restored: ${title}.`)
                focusLater(cardId(proposal))
              }}
            />
          </li>
        )
      })}
    </ul>
  )
}
