// What one of Claude's proposals changes, in a few words, which also names its card's buttons.
import { shortBullet } from '../../shared/api/bullets'
import type { Proposal } from '../../shared/api/chat'

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

export function describe(proposal: Proposal, sectionTitle: (id: number) => string) {
  const noun = NAMES[proposal.target]
  const name = isText(proposal) ? `"${shortBullet(proposal.before)}"` : proposal.before
  const where = proposal.target === 'section' ? '' : ` in ${sectionTitle(proposal.section_id)}`
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
