// A section's dialog: rename it (following "Changing an item" in docs/FRONTEND_CHECKS.md), delete
// it, and edit which narrative content, skill categories, roles, projects, bullets, and education
// entries it lists. Each of those opens in the same dialog. Only its default kind and the kinds it
// already lists show; the rest are under More options. A built-in section can't be hidden or
// deleted, and a new title for it saves a new section.
import { Fragment, useState, type ReactNode } from 'react'
import { bulletsApi, shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { educationApi, educationLabel } from '../../shared/api/education'
import { experienceApi, experienceLabel } from '../../shared/api/experience'
import { narrativeApi } from '../../shared/api/narrativeContent'
import { projectLabel, projectsApi } from '../../shared/api/projects'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../../shared/api/sections'
import { skillCategoriesApi } from '../../shared/api/skills'
import { anyLocked, type Use } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import Disclosure from '../../shared/components/Disclosure/Disclosure'
import NameForm from '../../shared/components/NameForm/NameForm'
import OrderedList from '../../shared/components/OrderedList/OrderedList'
import ApplyChoice from '../ApplyChoice'
import { changeNote, inProgressUses, pickedFor, savedMessage } from '../applyChange'
import BulletList from '../BulletList'
import Collapsible from '../Collapsible/Collapsible'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { educationLabels, projectLabels, roleLabels } from './itemFields'
import { useItemData } from './useItemData'
import { offered } from '../../shared/offered'

const LOCKED_NOTE = 'A sent version uses this section, so the new title is saved as a new section. The sent version keeps the old one.'
const BUILT_IN_NOTE = 'Built-in sections keep their title, so saving adds a new section.'

// Narrative content in a list: its full text, and a short label for its buttons.
const narrativeItem = (excerpt: { content_id: number; content: string }) => ({
  id: excerpt.content_id,
  name: excerpt.content,
  label: `"${shortBullet(excerpt.content)}"`,
})

type ContentKind = 'narrative' | 'category' | 'experience' | 'project' | 'bullet' | 'education'
const KINDS: ContentKind[] = ['narrative', 'category', 'experience', 'project', 'bullet', 'education']

// The kind each built-in section holds by default, by id (never by title).
const BUILT_IN_KINDS: Record<number, ContentKind> = {
  [BUILT_IN_SECTION_IDS.summary]: 'narrative',
  [BUILT_IN_SECTION_IDS.skills]: 'category',
  [BUILT_IN_SECTION_IDS.experience]: 'experience',
  [BUILT_IN_SECTION_IDS.projects]: 'project',
  [BUILT_IN_SECTION_IDS.education]: 'education',
}

const counts = (section: Section): Record<ContentKind, number> => ({
  narrative: section.narrative_content.length,
  category: section.skill_categories.length,
  experience: section.experience.length,
  project: section.projects.length,
  bullet: section.bullets.length,
  education: section.education.length,
})

// The kinds shown outright: a built-in section's own kind, and every kind the section lists.
function shownKindsOf(section: Section): ContentKind[] {
  const count = counts(section)
  return KINDS.filter((kind) => kind === BUILT_IN_KINDS[section.id] || count[kind] > 0)
}

export default function SectionItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() =>
    Promise.all([
      sectionsApi.list(),
      skillCategoriesApi.list(),
      experienceApi.list(),
      projectsApi.list(),
      bulletsApi.list(),
      narrativeApi.list(),
      educationApi.list(),
    ]),
  )
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  // Decided once when it loads, so a kind added to from More options stays where the user is
  // working until the dialog opens again.
  const [shown, setShown] = useState<ContentKind[] | null>(null)

  const section = data?.[0].find((item) => item.id === id)
  if (section && !shown) setShown(shownKindsOf(section))
  if (!data || !section) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const [, categories, roles, projects, bullets, narrative, education] = data
  const { here, others, elsewhere } = inProgressUses(section.used_by, host.placed?.where)
  const sentNote = anyLocked(section.used_by) ? LOCKED_NOTE : undefined

  // Labels that tell versions apart (labels.ts), for what's listed and what can be added. A
  // section's lists hold short refs, so each is named from the full item when it's loaded.
  const roleLabel = roleLabels(roles)
  const projectLabelOf = projectLabels(projects)
  const educationLabelOf = educationLabels(education)
  const named = <T, R>(list: T[], idOf: (item: T) => number, labelOf: (item: T) => string, ref: R, refId: number, fallback: (ref: R) => string) => {
    const item = list.find((candidate) => idOf(candidate) === refId)
    return item ? labelOf(item) : fallback(ref)
  }
  // "Other" isn't listed under sections; it's offered wherever skills are added.
  const categoryChoices = categories
    .filter((category) => !category.built_in && !category.hidden)
    .map((category) => ({ id: category.category_id, name: category.category_name }))

  async function refresh() {
    await Promise.all([load(), host.refresh()])
  }

  async function rename(original: Section, title: string) {
    const saved = await sectionsApi.rename(original.id, title, pickedFor(here, applyTo))
    const message = savedMessage({
      newVersion: saved.id !== original.id,
      before: original.title,
      after: saved.title,
      here,
      doc: host.placed?.doc,
      checked: applyTo,
    })
    await host.saved(message, { kind: 'section', id: saved.id })
  }


  async function confirmDelete(original: Section) {
    setDeleteError(null)
    try {
      await sectionsApi.delete(original.id)
      await host.deleted(`Deleted "${original.title}".`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  // Each kind of content it can list, in this order.
  const lists: Record<ContentKind, ReactNode> = {
    narrative: (
      <Collapsible title="Narrative content" count={section.narrative_content.length}>
        <OrderedList
          label={`${section.title} narrative content`}
          items={section.narrative_content.map(narrativeItem)}
          choices={offered(narrative).map(narrativeItem)}
          emptyText="None."
          onOpen={(item) => host.open({ kind: 'narrative', id: item.id, title: shortBullet(item.name) })}
          onChange={async (ids) => {
            await sectionsApi.setNarrativeContent(section.id, ids)
            await refresh()
          }}
        />
        <NameForm
          label={`New narrative content for ${section.title}`}
          field="content"
          submitLabel="Add narrative content"
          multiline
          onSave={async (content) => {
            await narrativeApi.create(content, [section.id])
            await refresh()
            host.say(`Added the narrative content "${shortBullet(content)}".`)
          }}
        />
      </Collapsible>
    ),
    category: (
      <Collapsible title="Skill categories" count={section.skill_categories.length}>
        <OrderedList
          label={`${section.title} skill categories`}
          items={section.skill_categories.map((category) => ({ id: category.category_id, name: category.category_name }))}
          choices={categoryChoices}
          emptyText="None."
          onOpen={(item) => host.open({ kind: 'category', id: item.id, title: item.name })}
          onChange={async (ids) => {
            await sectionsApi.setCategories(section.id, ids)
            await refresh()
          }}
        />
      </Collapsible>
    ),
    experience: (
      <Collapsible title="Roles" count={section.experience.length}>
        <OrderedList
          label={`${section.title} roles`}
          items={section.experience.map((role) => ({
            id: role.experience_id,
            name: named(roles, (item) => item.experience_id, roleLabel, role, role.experience_id, experienceLabel),
          }))}
          choices={offered(roles).map((role) => ({ id: role.experience_id, name: roleLabel(role) }))}
          emptyText="None."
          onOpen={(item) => host.open({ kind: 'experience', id: item.id, title: item.name })}
          onChange={async (ids) => {
            await sectionsApi.setExperience(section.id, ids)
            await refresh()
          }}
        />
      </Collapsible>
    ),
    project: (
      <Collapsible title="Projects" count={section.projects.length}>
        <OrderedList
          label={`${section.title} projects`}
          items={section.projects.map((project) => ({
            id: project.project_id,
            name: named(projects, (item) => item.project_id, projectLabelOf, project, project.project_id, projectLabel),
          }))}
          choices={offered(projects).map((project) => ({ id: project.project_id, name: projectLabelOf(project) }))}
          emptyText="None."
          onOpen={(item) => host.open({ kind: 'project', id: item.id, title: item.name })}
          onChange={async (ids) => {
            await sectionsApi.setProjects(section.id, ids)
            await refresh()
          }}
        />
      </Collapsible>
    ),
    bullet: (
      <BulletList
        owner={section.title}
        bullets={section.bullets}
        allBullets={offered(bullets).map((bullet) => ({ bullet_id: bullet.bullet_id, content: bullet.content }))}
        onChange={async (ids) => {
          await sectionsApi.setBullets(section.id, ids)
          await refresh()
        }}
        onWrite={async (content) => {
          await bulletsApi.create(content, { section_id: section.id })
          await refresh()
          host.say(`Added the bullet "${shortBullet(content)}".`)
        }}
      />
    ),
    education: (
      <Collapsible title="Education" count={section.education.length}>
        <OrderedList
          label={`${section.title} education`}
          items={section.education.map((entry) => ({
            id: entry.education_id,
            name: named(education, (item) => item.education_id, educationLabelOf, entry, entry.education_id, educationLabel),
          }))}
          choices={offered(education).map((entry) => ({ id: entry.education_id, name: educationLabelOf(entry) }))}
          emptyText="None."
          onOpen={(item) => host.open({ kind: 'education', id: item.id, title: item.name })}
          onChange={async (ids) => {
            await sectionsApi.setEducation(section.id, ids)
            await refresh()
          }}
        />
      </Collapsible>
    ),
  }
  const shownKinds = shown ?? []
  const moreKinds = KINDS.filter((kind) => !shownKinds.includes(kind))

  return (
    <ItemParts
      name={`"${section.title}"`}
      hidden={section.hidden}
      usedBySent={anyLocked(section.used_by)}
      onSetHidden={section.built_in ? undefined : async (next) => {
        await sectionsApi.setHidden(section.id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <NameForm
          label="Section title"
          field="title"
          initial={section.title}
          lockedNote={changeNote(here, others, host.placed?.doc, section.built_in ? BUILT_IN_NOTE : sentNote, section.built_in || elsewhere)}
          onSave={(title) => rename(section, title)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          {others.length > 0 && <ApplyChoice uses={others} others={Boolean(here)} applyTo={applyTo} onChange={setApplyTo} />}
        </NameForm>
      }
      confirmDelete={
        section.built_in
          ? undefined
          : (back) => (
              <ConfirmDelete
                what={`"${section.title}"`}
                uses={section.used_by}
                effect="It and everything placed in it are removed from them. The library items it lists stay in the library."
                error={deleteError}
                onConfirm={() => void confirmDelete(section)}
                onCancel={back}
              />
            )
      }
    >
      {shownKinds.map((kind) => (
        <Fragment key={kind}>{lists[kind]}</Fragment>
      ))}
      {moreKinds.length > 0 && (
        <Disclosure
          title={
            <>
              More options <span className="visually-hidden">for {section.title}</span>
            </>
          }
          initiallyOpen={shownKinds.length === 0}
        >
          {moreKinds.map((kind) => (
            <Fragment key={kind}>{lists[kind]}</Fragment>
          ))}
        </Disclosure>
      )}

      <UsedBy uses={section.used_by} />
    </ItemParts>
  )
}
