// What one of Claude's proposals changes, in a few words, which also names its card's buttons.
// Where it is names its immediate parent: the skill category, role, or project a skill or bullet
// is under ("in Back End"), or for anything placed directly in a section, the section.
import { shortBullet } from '../../shared/api/bullets'
import { isRule, type AnyProposal, type Proposal, type RuleProposal } from '../../shared/api/chat'
import type { TreeSection } from '../../shared/api/documents'
import { itemName } from '../treeItems'

const NAMES: Record<Proposal['target'], string> = {
  section: 'section',
  narrative: 'text',
  bullet: 'bullet',
  experience: 'role',
  project: 'project',
  category: 'skill category',
  education: 'education entry',
  skill: 'skill',
}

const isText = (proposal: Proposal) => proposal.target === 'narrative' || proposal.target === 'bullet'

// The parent's name as the document has it now, or the section's when the parent isn't there
// (an applied change that removed it), or "a section" when that's gone too.
function parentName(proposal: Proposal, sections: TreeSection[]) {
  const section = sections.find((one) => one.section_id === proposal.section_id)
  const parent = proposal.parent_kind
    ? section?.entries.find((entry) => entry.kind === proposal.parent_kind && entry.item_id === proposal.parent_id)
    : undefined
  return (parent && itemName(parent.kind, parent.values)) || section?.title || 'a section'
}

// A rule's: what it bans, or what it changes in which tone ("Add "Name the tools." to the "Tech"
// tone").
function describeRule(proposal: RuleProposal) {
  const quoted = (text: string) => `"${shortBullet(text)}"`
  if (proposal.target === 'banned') {
    return proposal.action === 'add' ? `Ban ${quoted(proposal.new_text)}` : `Stop banning ${quoted(proposal.before)}`
  }
  const tone = `the "${proposal.tone_name}" tone`
  switch (proposal.action) {
    case 'add':
      return `Add ${quoted(proposal.new_text)} to ${tone}`
    case 'reword':
      return `Reword ${quoted(proposal.before)} in ${tone}`
    case 'remove':
      return `Remove ${quoted(proposal.before)} from ${tone}`
  }
}

export function describe(proposal: AnyProposal, sections: TreeSection[]) {
  if (isRule(proposal)) return describeRule(proposal)
  const noun = NAMES[proposal.target]
  const name = isText(proposal) ? `"${shortBullet(proposal.before)}"` : proposal.before
  const where = proposal.target === 'section' ? '' : ` in ${parentName(proposal, sections)}`
  const what = proposal.target === 'section' ? `the ${proposal.before} section` : `the ${noun} ${name}${where}`
  const to = proposal.position > 0 ? `to position ${proposal.position}` : 'to the end'
  switch (proposal.action) {
    case 'reword':
      return `Reword ${what}`
    case 'add':
      return proposal.item_id === 0 ? `Add new ${noun}${where}` : `Add ${what}`
    case 'remove':
      return `Remove ${what}`
    case 'move':
      return `Move ${what} ${to}`
  }
}

// A card's id on the page, so focus can be moved to it (after Apply, from "Waiting for you", or
// from a message that replied to it).
export const cardId = (messageId: number, proposalId: string) => `proposal-${messageId}-${proposalId}`

// One of the user's messages in the chat panel, so a card it replied to can move focus to it.
export const messageId = (id: number) => `chat-message-${id}`
