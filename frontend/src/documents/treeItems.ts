// What DocumentTree, DraftTree, and AddContent share about the items placed in a section: the library they
// come from, what each kind is called, how an item is named, which kind a section starts with,
// and the fields of a new item of each kind.
import { bulletsApi, shortBullet, type Bullet } from '../shared/api/bullets'
import type { EntryKind, TreeEntry } from '../shared/api/documents'
import { educationApi, educationLabel, type Education } from '../shared/api/education'
import { experienceApi, experienceLabel, type Experience } from '../shared/api/experience'
import { narrativeApi, type NarrativeContent } from '../shared/api/narrativeContent'
import { projectLabel, projectsApi, type Project } from '../shared/api/projects'
import { sectionsApi, type Section } from '../shared/api/sections'
import { skillCategoriesApi, type SkillCategory } from '../shared/api/skills'
import type { ListItem } from '../shared/components/OrderedList/OrderedList'
import { distinctLabels } from '../shared/api/labels'
import { offered } from '../shared/offered'

export interface Library {
  sections: Section[]
  narrative: NarrativeContent[]
  categories: SkillCategory[]
  experience: Experience[]
  projects: Project[]
  bullets: Bullet[]
  education: Education[]
}

export async function loadLibrary(): Promise<Library> {
  const [sections, narrative, categories, experience, projects, bullets, education] = await Promise.all([
    sectionsApi.list(),
    narrativeApi.list(),
    skillCategoriesApi.list(),
    experienceApi.list(),
    projectsApi.list(),
    bulletsApi.list(),
    educationApi.list(),
  ])
  return { sections, narrative, categories, experience, projects, bullets, education }
}

// What each kind is called: before an item's name in a section's list (one), as a type of
// content (type), and in a sentence (lower).
export const KIND_NAMES: Record<EntryKind, { one: string; type: string; lower: string }> = {
  experience: { one: 'Role', type: 'Role', lower: 'role' },
  project: { one: 'Project', type: 'Project', lower: 'project' },
  category: { one: 'Skills', type: 'Skill category', lower: 'skill category' },
  education: { one: 'Education', type: 'Education', lower: 'education entry' },
  bullet: { one: 'Bullet', type: 'Bullet', lower: 'bullet' },
  narrative: { one: 'Text', type: 'Narrative content', lower: 'narrative content' },
}

// The kinds in the order the type picker offers them.
export const KINDS_IN_ORDER = Object.keys(KIND_NAMES) as EntryKind[]

export const keyOf = (kind: EntryKind, itemId: number) => `${kind}:${itemId}`

export function fromKey(key: string) {
  const [kind, itemId] = key.split(':')
  return { kind: kind as EntryKind, item_id: Number(itemId) }
}

// An item in a section's list: its kind, then what it is. Long text is shortened in button labels.
export function entryItem(kind: EntryKind, itemId: number, name: string, short = name): ListItem<string> {
  const { one } = KIND_NAMES[kind]
  return { id: keyOf(kind, itemId), name: `${one}: ${name}`, label: `${one}: ${short}` }
}

// What an item is called without its kind, from its library values.
export function itemName(kind: EntryKind, values: Record<string, string | null | undefined>) {
  const text = (name: string) => values[name] ?? ''
  switch (kind) {
    case 'narrative':
    case 'bullet':
      return text('content')
    case 'category':
      return text('category_name')
    case 'experience':
      return experienceLabel({ role_title: text('role_title'), organization: text('organization'), dates: values.dates ?? null })
    case 'project':
      return projectLabel({ project_title: text('project_title'), done_for: values.done_for ?? null })
    case 'education':
      return educationLabel({ degree: text('degree'), institution: text('institution'), graduation: values.graduation ?? null })
  }
}

const isText = (kind: EntryKind) => kind === 'narrative' || kind === 'bullet'

export function placedItem(entry: TreeEntry) {
  const name = itemName(entry.kind, entry.values)
  return entryItem(entry.kind, entry.item_id, name, isText(entry.kind) ? `"${shortBullet(name)}"` : name)
}

// Each item with its label, telling versions apart (labels.ts).
const named = <T extends { created_at: string }>(items: T[], label: (item: T) => string) => {
  const labelOf = distinctLabels(items, label, (item) => item.created_at)
  return items.map((item) => [item, labelOf(item)] as const)
}

// Every saved item of one kind that can be offered (not hidden: docs/FRONTEND_CHECKS.md,
// "Hiding"), as { id, name }, oldest first.
export function savedItems(library: Library, kind: EntryKind): { id: number; name: string }[] {
  switch (kind) {
    case 'narrative':
      return offered(library.narrative).map((item) => ({ id: item.content_id, name: item.content }))
    case 'bullet':
      return offered(library.bullets).map((item) => ({ id: item.bullet_id, name: item.content }))
    case 'category':
      return offered(library.categories).map((item) => ({ id: item.category_id, name: item.category_name }))
    case 'experience':
      return named(offered(library.experience), experienceLabel).map(([item, name]) => ({ id: item.experience_id, name }))
    case 'project':
      return named(offered(library.projects), projectLabel).map(([item, name]) => ({ id: item.project_id, name }))
    case 'education':
      return named(offered(library.education), educationLabel).map(([item, name]) => ({ id: item.education_id, name }))
  }
}

// The ids of the items of one kind that the library lists under a section.
export function listedIds(library: Library, sectionId: number, kind: EntryKind): number[] {
  const section = library.sections.find((item) => item.id === sectionId)
  if (!section) return []
  return {
    narrative: section.narrative_content.map((item) => item.content_id),
    bullet: section.bullets.map((item) => item.bullet_id),
    category: section.skill_categories.map((item) => item.category_id),
    experience: section.experience.map((item) => item.experience_id),
    project: section.projects.map((item) => item.project_id),
    education: section.education.map((item) => item.education_id),
  }[kind]
}

// The kind a section's content starts with: the kind the library lists most under it (first in
// KINDS_IN_ORDER on a tie), or null when it lists nothing. Never decided from the title.
export function defaultKind(library: Library, sectionId: number): EntryKind | null {
  let best: EntryKind | null = null
  let most = 0
  for (const kind of KINDS_IN_ORDER) {
    const count = listedIds(library, sectionId, kind).length
    if (count > most) {
      best = kind
      most = count
    }
  }
  return best
}

export interface NewField {
  name: string
  label: string
  required?: boolean
  multiline?: boolean
  type?: 'text' | 'url'
}

// The fields of a new item of each kind, as in the library's own forms.
export const NEW_FIELDS: Record<EntryKind, NewField[]> = {
  experience: [
    { name: 'role_title', label: 'Role title', required: true },
    { name: 'organization', label: 'Organization', required: true },
    { name: 'location', label: 'Location' },
    { name: 'dates', label: 'Dates' },
  ],
  project: [
    { name: 'project_title', label: 'Title', required: true },
    { name: 'done_for', label: 'Done for' },
    { name: 'url', label: 'Link', type: 'url' },
    { name: 'dates', label: 'Dates' },
  ],
  category: [{ name: 'category_name', label: 'Name', required: true }],
  education: [
    { name: 'degree', label: 'Degree', required: true },
    { name: 'institution', label: 'Institution', required: true },
    { name: 'details', label: 'Details', multiline: true },
    { name: 'graduation', label: 'Graduation' },
  ],
  bullet: [{ name: 'content', label: 'Bullet text', required: true, multiline: true }],
  narrative: [{ name: 'content', label: 'Text', required: true, multiline: true }],
}

// The fields a placed role, project, or education entry shows when opened.
export const SHOWN_FIELDS: Partial<Record<EntryKind, NewField[]>> = {
  experience: NEW_FIELDS.experience,
  project: NEW_FIELDS.project,
  education: NEW_FIELDS.education,
}
