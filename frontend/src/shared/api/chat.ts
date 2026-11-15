// The chat with Claude beside a resume or cover letter (backend/app/chat.py). Reading the
// conversation is an ordinary request; sending a message streams Claude's reply as JSON lines:
// "text" pieces as they're written, "checking" while its proposals are checked against the writing
// rules, then "done" with the two saved turns, or "error" (in the
// shape in docs/API_ERRORS.md), after which nothing is saved.
import { api, ApiError, errorOf, type ErrorBody } from './client'
import { KINDS, withId, type DocDetail, type DocKind, type EntryKind, type Raw, type WritingFlag } from './documents'

// What a message is about: the whole document, a section in it, or an item in it (an entry in a
// section, or a skill or bullet under one), with how the panel names it.
export interface ChatAbout {
  level: 'document' | 'section' | 'item'
  label?: string | null
  section_id?: number | null
  kind?: EntryKind | 'skill' | null
  item_id?: number | null
  parent_kind?: 'experience' | 'project' | 'category' | null
  parent_id?: number | null
  // An item dialog's values not saved yet.
  unsaved?: Record<string, string | null> | null
}

// "stale": applying a later proposal for the same content set it aside.
export type ProposalState = 'pending' | 'applied' | 'dismissed' | 'stale'

// One change Claude proposed, shown as a card the user applies or dismisses.
export interface Proposal {
  id: string
  action: 'reword' | 'add' | 'remove' | 'move'
  target: 'section' | 'narrative' | 'bullet' | 'experience' | 'project' | 'category' | 'education' | 'skill'
  section_id: number
  // 0 for a section, or for new text.
  item_id: number
  parent_kind: '' | 'experience' | 'project' | 'category'
  parent_id: number
  new_text: string
  // Counting from 1 after the change; 0 for the end.
  position: number
  reason: string
  // What it changes, as it read when Claude proposed it.
  before: string
  state: ProposalState
  // For text it puts in the document (checksText): the writing rules it still breaks, whether
  // `new_text` is the writing check's fixed wording, and whether the check ran.
  flags?: WritingFlag[]
  fixed?: boolean
  checked?: boolean
}

// Whether the proposal puts narrative content or a bullet's text in the document (Claude's
// wording, or a saved item as it is), so the writing check reads it.
export const checksText = (proposal: Proposal) =>
  (proposal.target === 'narrative' || proposal.target === 'bullet') && (proposal.action === 'reword' || proposal.action === 'add')

// The reply's proposals the writing check couldn't read and that aren't applied (or stale), which
// "Check writing rules again" checks.
export const uncheckedOf = (message: ChatMessage) =>
  (message.proposals ?? []).filter(
    (proposal) => checksText(proposal) && !proposal.checked && (proposal.state === 'pending' || proposal.state === 'dismissed'),
  )

// One of Claude's proposals a message replies to (its card's Reply): the message it's in, its id,
// the card's title, and its new text, if it has any, as it read when the user replied.
export interface ReplyTo {
  message_id: number
  proposal_id: string
  label: string
  text: string
}

// What applying a proposal changed in the chat: its message, the other messages whose earlier
// proposals for the same content it set aside, and how many went stale in all.
export interface Applied {
  message: ChatMessage
  updated: ChatMessage[]
  stale: number
}

// " 2 earlier changes to the same content are now stale." for announcing an apply, or nothing.
export const staleNote = (stale: number) =>
  stale === 0 ? '' : ` ${stale === 1 ? '1 earlier change to the same content is' : `${stale} earlier changes to the same content are`} now stale.`

export interface ChatMessage {
  message_id: number
  role: 'user' | 'assistant'
  text: string
  about: ChatAbout | null
  proposals: Proposal[] | null
  reply_to?: ReplyTo | null
  created_at: string | null
}

type Line =
  | { type: 'text'; text: string }
  | { type: 'checking' }
  | { type: 'done'; messages: ChatMessage[] }
  | ({ type: 'error' } & ErrorBody)

const UNREACHABLE = "Couldn't reach the app's server. Check that the backend is running."
const CUT_OFF = 'The reply stopped before it finished. Nothing was saved. Try again.'

export function chatApi(kind: DocKind) {
  const path = KINDS[kind].path
  return {
    list: (id: number) => api.get<ChatMessage[]>(`${path}/${id}/chat`),
    // Makes the proposed change to the document, and returns it with what changed in the chat
    // (earlier proposals for the same content go stale).
    apply: (id: number, messageId: number, proposalId: string) =>
      api
        .post<Applied & { document: Raw }>(`${path}/${id}/chat/${messageId}/proposals/${proposalId}/apply`)
        .then(({ document, ...applied }) => ({ ...applied, document: withId<DocDetail>(kind, document) })),
    // Dismisses a proposal, or takes that back.
    setState: (id: number, messageId: number, proposalId: string, state: 'pending' | 'dismissed') =>
      api.put<ChatMessage>(`${path}/${id}/chat/${messageId}/proposals/${proposalId}`, { state }),
    // Checks a reply's proposals against the writing rules again, after the check failed.
    check: (id: number, messageId: number) => api.post<ChatMessage>(`${path}/${id}/chat/${messageId}/check`),
    // Sends a message, calling `onText` with each piece of Claude's reply as it's written and
    // `onChecking` once the reply is written and its proposals are being checked against the
    // writing rules, and returns the two saved turns. `replyTo` is the proposal it replies to, if
    // any (the backend fills in its text). A refusal before the reply starts, or a failure during
    // it, throws an ApiError, and nothing is saved.
    async send(
      id: number,
      text: string,
      about: ChatAbout,
      onText: (piece: string) => void,
      onChecking: () => void = () => {},
      replyTo: ReplyTo | null = null,
    ): Promise<ChatMessage[]> {
      let response: Response
      try {
        response = await fetch(`/api${path}/${id}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            about,
            ...(replyTo && {
              reply_to: { message_id: replyTo.message_id, proposal_id: replyTo.proposal_id, label: replyTo.label },
            }),
          }),
        })
      } catch {
        throw new ApiError('INTERNAL_ERROR', UNREACHABLE, null, 0)
      }
      // A refusal before the reply starts is an ordinary error response.
      if (!response.ok) throw await errorOf(response)
      if (!response.body) throw new ApiError('INTERNAL_ERROR', CUT_OFF, null, response.status)
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffered = ''
      for (;;) {
        let chunk: ReadableStreamReadResult<string>
        try {
          chunk = await reader.read()
        } catch {
          throw new ApiError('INTERNAL_ERROR', CUT_OFF, null, 0)
        }
        if (chunk.done) break
        buffered += chunk.value
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const raw of lines) {
          if (!raw.trim()) continue
          const line = JSON.parse(raw) as Line
          if (line.type === 'text') onText(line.text)
          else if (line.type === 'checking') onChecking()
          else if (line.type === 'done') return line.messages
          else {
            const { code, message, field } = line.error
            throw new ApiError(code, message, field, 200)
          }
        }
      }
      throw new ApiError('INTERNAL_ERROR', CUT_OFF, null, 0)
    },
  }
}
