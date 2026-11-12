// What one of Claude's proposals changes, in a few words, which also names its card's buttons.
// Where it is names its immediate parent: the skill category, role, or project a skill or bullet
// is under ("in Back End"), or for anything placed directly in a section, the section.
import { shortBullet } from '../../shared/api/bullets'
import type { Proposal } from '../../shared/api/chat'
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

export function describe(proposal: Proposal, sections: TreeSection[]) {
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

// A card's id on the page, so focus can be moved to it (after Apply, or from "Waiting for you").
export const cardId = (messageId: number, proposalId: string) => `proposal-${messageId}-${proposalId}`
