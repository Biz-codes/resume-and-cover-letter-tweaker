// A section's dialog: rename it (a sent version keeps the old title; docs/FRONTEND_CHECKS.md, "Sent
// versions are locked"), add a version of it, delete it, and edit which narrative content, skill
// categories, roles, projects, bullets, and education entries it lists. Each of those opens in the
// same dialog. A built-in section can't be renamed or deleted, so its dialog has only New version
// and its lists.
import { useState } from 'react'
import { bulletsApi, shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { educationApi, educationLabel } from '../../shared/api/education'
import { experienceApi, experienceLabel } from '../../shared/api/experience'
import { narrativeApi } from '../../shared/api/narrativeContent'
import { projectLabel, projectsApi } from '../../shared/api/projects'
import { sectionsApi, type Section } from '../../shared/api/sections'
import { skillCategoriesApi } from '../../shared/api/skills'
import { anyLocked } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import NameForm from '../../shared/components/NameForm/NameForm'
import OrderedList from '../../shared/components/OrderedList/OrderedList'
import BulletList from '../BulletList'
import Collapsible from '../Collapsible/Collapsible'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { educationLabels, projectLabels, roleLabels } from './itemFields'
import { useItemData } from './useItemData'

const LOCKED_NOTE = 'A sent version uses this section, so the new title is saved as a new section. The sent version keeps the old one.'

// Narrative content in a list: its full text, and a short label for its buttons.
const narrativeItem = (excerpt: { content_id: number; content: string }) => ({
  id: excerpt.content_id,
  name: excerpt.content,
  label: `"${shortBullet(excerpt.content)}"`,
})

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
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const section = data?.[0].find((item) => item.id === id)
  if (!data || !section) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const [, categories, roles, projects, bullets, narrative, education] = data

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
    .filter((category) => !category.built_in)
    .map((category) => ({ id: category.category_id, name: category.category_name }))

  async function refresh() {
    await Promise.all([load(), host.refresh()])
  }

  async function rename(original: Section, title: string) {
    const saved = await sectionsApi.rename(original.id, title)
    await host.saved(
      saved.id === original.id ? 'Saved.' : `Saved as a new section, "${saved.title}". Sent versions keep "${original.title}".`,
      { kind: 'section', id: saved.id },
    )
  }

  async function addVersion(original: Section, title: string) {
    const version = await sectionsApi.addVersion(original.id, title)
    await host.saved(
      `Added "${version.title}", with the same lists. Resumes and cover letters keep "${original.title}" until you pick the new one.`,
      { kind: 'section', id: version.id },
    )
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

  return (
    <ItemParts
      form={
        !section.built_in && (
          <NameForm
            label="Section title"
            field="title"
            initial={section.title}
            lockedNote={anyLocked(section.used_by) ? LOCKED_NOTE : undefined}
            onSave={(title) => rename(section, title)}
          focusOnOpen={false}
          onCancel={host.close}
          />
        )
      }
      newVersion={(back) => (
        <NameForm
          label="New version's title"
          field="title"
          initial={section.title}
          submitLabel="Add version"
          onSave={(title) => addVersion(section, title)}
          onCancel={back}
        />
      )}
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
      <Collapsible title="Narrative content it lists" count={section.narrative_content.length}>
        <OrderedList
          label={`${section.title} narrative content`}
          items={section.narrative_content.map(narrativeItem)}
          choices={narrative.map(narrativeItem)}
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
            host.say(`Added "${shortBullet(content)}" to the narrative content it lists.`)
          }}
        />
      </Collapsible>

      <Collapsible title="Skill categories it lists" count={section.skill_categories.length}>
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

      <Collapsible title="Roles it lists" count={section.experience.length}>
        <OrderedList
          label={`${section.title} roles`}
          items={section.experience.map((role) => ({
            id: role.experience_id,
            name: named(roles, (item) => item.experience_id, roleLabel, role, role.experience_id, experienceLabel),
          }))}
          choices={roles.map((role) => ({ id: role.experience_id, name: roleLabel(role) }))}
          emptyText="None."
          onOpen={(item) => host.open({ kind: 'experience', id: item.id, title: item.name })}
          onChange={async (ids) => {
            await sectionsApi.setExperience(section.id, ids)
            await refresh()
          }}
        />
      </Collapsible>

      <Collapsible title="Projects it lists" count={section.projects.length}>
        <OrderedList
          label={`${section.title} projects`}
          items={section.projects.map((project) => ({
            id: project.project_id,
            name: named(projects, (item) => item.project_id, projectLabelOf, project, project.project_id, projectLabel),
          }))}
          choices={projects.map((project) => ({ id: project.project_id, name: projectLabelOf(project) }))}
          emptyText="None."
          onOpen={(item) => host.open({ kind: 'project', id: item.id, title: item.name })}
          onChange={async (ids) => {
            await sectionsApi.setProjects(section.id, ids)
            await refresh()
          }}
        />
      </Collapsible>

      <BulletList
        owner={section.title}
        title="Bullets it lists directly"
        bullets={section.bullets}
        allBullets={bullets.map((bullet) => ({ bullet_id: bullet.bullet_id, content: bullet.content }))}
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

      <Collapsible title="Education it lists" count={section.education.length}>
        <OrderedList
          label={`${section.title} education`}
          items={section.education.map((entry) => ({
            id: entry.education_id,
            name: named(education, (item) => item.education_id, educationLabelOf, entry, entry.education_id, educationLabel),
          }))}
          choices={education.map((entry) => ({ id: entry.education_id, name: educationLabelOf(entry) }))}
          emptyText="None."
          onOpen={(item) => host.open({ kind: 'education', id: item.id, title: item.name })}
          onChange={async (ids) => {
            await sectionsApi.setEducation(section.id, ids)
            await refresh()
          }}
        />
      </Collapsible>

      <UsedBy uses={section.used_by} />
    </ItemParts>
  )
}
