// Library page for sections: add sections, and open each one's dialog (ItemDialog) to rename it,
// add a version of it, delete it, and edit which narrative content, skill categories, roles,
// projects, bullets, and education entries it lists. Built-in sections can't be renamed or deleted
// (docs/FRONTEND_CHECKS.md).
// Sections are grouped by whether their titles print: resume headings do, cover letter
// section titles are labels only the user sees (docs/DATABASE.md, section notes).
import { useCallback, useEffect, useState } from 'react'
import { bulletsApi, shortBullet, type Bullet } from '../shared/api/bullets'
import { toApiError, type ApiError } from '../shared/api/client'
import { educationApi, educationLabel, type Education } from '../shared/api/education'
import { experienceLabel, experienceApi, type Experience } from '../shared/api/experience'
import { projectLabel, projectsApi, type Project } from '../shared/api/projects'
import { sectionsApi, type Section } from '../shared/api/sections'
import { narrativeApi, type NarrativeContent } from '../shared/api/narrativeContent'
import { skillCategoriesApi, type SkillCategory } from '../shared/api/skills'
import { anyLocked } from '../shared/api/usage'
import BulletList from './BulletList'
import Collapsible from './Collapsible/Collapsible'
import ConfirmDelete from '../shared/components/ConfirmDelete'
import NameForm from '../shared/components/NameForm/NameForm'
import ItemDialog from './ItemDialog'
import LibraryCard from './LibraryCard'
import OrderedList from '../shared/components/OrderedList/OrderedList'
import UsedBy from './UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { distinctLabels } from '../shared/api/labels'

type Group = 'resume' | 'letter' | 'unused'

const GROUPS: { group: Group; heading: string; note: string }[] = [
  { group: 'resume', heading: 'Resume headings', note: 'Printed as headings in your resumes.' },
  {
    group: 'letter',
    heading: 'Cover letter labels',
    note: "Only you see these. Cover letters don't print section titles.",
  },
  {
    group: 'unused',
    heading: 'Not used yet',
    note: 'Printed if you use one in a resume; only a label in a cover letter.',
  },
]

function groupOf(section: Section): Group {
  if (section.built_in || section.used_by.some((use) => use.kind === 'resume')) return 'resume'
  return section.used_by.some((use) => use.kind === 'cover_letter') ? 'letter' : 'unused'
}

// The Edit button's id, where focus returns when the dialog closes after a save.
const editId = (id: number) => `section-${id}-edit`

const LOCKED_NOTE = 'A sent version uses this section, so the new title is saved as a new section. The sent version keeps the old one.'

export default function SectionsPage() {
  const [sections, setSections] = useState<Section[] | null>(null)
  const [categories, setCategories] = useState<SkillCategory[]>([])
  const [roles, setRoles] = useState<Experience[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [bullets, setBullets] = useState<Bullet[]>([])
  const [narrative, setNarrative] = useState<NarrativeContent[]>([])
  const [education, setEducation] = useState<Education[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  // The section whose dialog is open.
  const [editing, setEditing] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Said in the dialog, for a change that keeps it open (something new written in it).
  const [dialogNotice, setDialogNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Sections')

  const load = useCallback(
    () =>
      Promise.all([
        sectionsApi.list(),
        skillCategoriesApi.list(),
        experienceApi.list(),
        projectsApi.list(),
        bulletsApi.list(),
        narrativeApi.list(),
        educationApi.list(),
      ])
        .then(([sectionList, categoryList, roleList, projectList, bulletList, narrativeList, educationList]) => {
          setSections(sectionList)
          setCategories(categoryList)
          setRoles(roleList)
          setProjects(projectList)
          setBullets(bulletList)
          setNarrative(narrativeList)
          setEducation(educationList)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  // "Other" isn't listed under sections; it's offered wherever skills are added.
  const categoryChoices = categories
    .filter((category) => !category.built_in)
    .map((category) => ({ id: category.category_id, name: category.category_name }))
  // Labels that tell versions apart (labels.ts), for what's listed and what can be added. A
  // section's lists hold short refs, so each is named from the full item.
  const roleLabel = distinctLabels(roles, experienceLabel, (item) => item.created_at)
  const projectLabelOf = distinctLabels(projects, projectLabel, (item) => item.created_at)
  const educationLabelOf = distinctLabels(education, educationLabel, (item) => item.created_at)
  const named = <T, R>(list: T[], id: (item: T) => number, labelOf: (item: T) => string, ref: R, refId: number, fallback: (ref: R) => string) => {
    const item = list.find((candidate) => id(candidate) === refId)
    return item ? labelOf(item) : fallback(ref)
  }
  const roleChoices = roles.map((role) => ({ id: role.experience_id, name: roleLabel(role) }))
  const projectChoices = projects.map((project) => ({ id: project.project_id, name: projectLabelOf(project) }))
  const allBullets = bullets.map((bullet) => ({ bullet_id: bullet.bullet_id, content: bullet.content }))
  const narrativeItem = (excerpt: { content_id: number; content: string }) => ({
    id: excerpt.content_id,
    name: excerpt.content,
    label: `"${shortBullet(excerpt.content)}"`,
  })
  const narrativeChoices = narrative.map(narrativeItem)
  const educationChoices = education.map((entry) => ({ id: entry.education_id, name: educationLabelOf(entry) }))

  async function create(title: string) {
    await sectionsApi.create(title)
    setNotice(`Added "${title.trim()}".`)
    await load()
  }

  async function rename(section: Section, title: string) {
    const saved = await sectionsApi.rename(section.id, title)
    setEditing(null)
    await load()
    setNotice(
      saved.id === section.id
        ? 'Saved.'
        : `Saved as a new section, "${saved.title}". Sent versions keep "${section.title}".`,
    )
    focusLater(editId(saved.id))
  }

  async function addVersion(section: Section, title: string) {
    const version = await sectionsApi.addVersion(section.id, title)
    setEditing(null)
    await load()
    setNotice(`Added "${version.title}", with the same lists. Resumes and cover letters keep "${section.title}" until you pick the new one.`)
    focusLater(editId(version.id))
  }

  async function confirmDelete(section: Section) {
    setDeleteError(null)
    try {
      await sectionsApi.delete(section.id)
      setEditing(null)
      focusLater(PAGE_HEADING_ID)
      await load()
      setNotice(`Deleted "${section.title}".`)
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  // A built-in section can't be renamed or deleted, so its dialog has only New version and its lists.
  function itemDialog(section: Section) {
    return (
      <ItemDialog
        notice={dialogNotice}
        title={section.title}
        onClose={() => setEditing(null)}
        form={
          !section.built_in && (
            <NameForm
              label="Section title"
              field="title"
              initial={section.title}
              lockedNote={anyLocked(section.used_by) ? LOCKED_NOTE : undefined}
              onSave={(title) => rename(section, title)}
              onCancel={() => setEditing(null)}
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
            choices={narrativeChoices}
            emptyText="None."
            onChange={async (ids) => {
              await sectionsApi.setNarrativeContent(section.id, ids)
              await load()
            }}
          />
          <NameForm
            label={`New narrative content for ${section.title}`}
            field="content"
            submitLabel="Add narrative content"
            multiline
            onSave={async (content) => {
              await narrativeApi.create(content, [section.id])
              await load()
              setDialogNotice(`Added "${shortBullet(content)}" to the narrative content it lists.`)
            }}
          />
        </Collapsible>

        <Collapsible title="Skill categories it lists" count={section.skill_categories.length}>
          <OrderedList
            label={`${section.title} skill categories`}
            items={section.skill_categories.map((category) => ({
              id: category.category_id,
              name: category.category_name,
            }))}
            choices={categoryChoices}
            emptyText="None."
            onChange={async (ids) => {
              await sectionsApi.setCategories(section.id, ids)
              await load()
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
            choices={roleChoices}
            emptyText="None."
            onChange={async (ids) => {
              await sectionsApi.setExperience(section.id, ids)
              await load()
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
            choices={projectChoices}
            emptyText="None."
            onChange={async (ids) => {
              await sectionsApi.setProjects(section.id, ids)
              await load()
            }}
          />
        </Collapsible>

        <BulletList
          owner={section.title}
          title="Bullets it lists directly"
          bullets={section.bullets}
          allBullets={allBullets}
          onChange={async (ids) => {
            await sectionsApi.setBullets(section.id, ids)
            await load()
          }}
          onWrite={async (content) => {
            await bulletsApi.create(content, { section_id: section.id })
            await load()
            setDialogNotice(`Added the bullet "${shortBullet(content)}".`)
          }}
        />

        <Collapsible title="Education it lists" count={section.education.length}>
          <OrderedList
            label={`${section.title} education`}
            items={section.education.map((entry) => ({
              id: entry.education_id,
              name: named(education, (item) => item.education_id, educationLabelOf, entry, entry.education_id, educationLabel),
            }))}
            choices={educationChoices}
            emptyText="None."
            onChange={async (ids) => {
              await sectionsApi.setEducation(section.id, ids)
              await load()
            }}
          />
        </Collapsible>

        <UsedBy uses={section.used_by} />
      </ItemDialog>
    )
  }

  const editingSection = sections?.find((section) => section.id === editing)

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Sections
      </h2>
      <p className="muted">
        Resume headings and cover letter topics. Any content can go in any section; the lists here
        are only what the app suggests first.
      </p>
      <p role="status">{notice}</p>
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!sections && !loadError && <p>Loading…</p>}

      {sections && <NameForm label="New section title" field="title" submitLabel="Add section" onSave={create} />}

      {sections &&
        GROUPS.map(({ group, heading, note }) => {
          const members = sections.filter((section) => groupOf(section) === group)
          if (members.length === 0) return null
          return (
            <div key={group} className="section-group">
              <h3>{heading}</h3>
              <p className="muted">{note}</p>
              {members.map((section) => (
                <LibraryCard
                  key={section.id}
                  title={section.title}
                  tags={
                    <>
                      {section.built_in && <span className="tag">built in</span>}
                      {group === 'resume' && section.used_by.some((use) => use.kind === 'cover_letter') && (
                        <span className="tag">also a cover letter label</span>
                      )}
                    </>
                  }
                  editId={editId(section.id)}
                  editLabel={`Edit "${section.title}"`}
                  onEdit={() => {
                    setEditing(section.id)
                    setDialogNotice(null)
                    setDeleteError(null)
                    setNotice(null)
                  }}
                />
              ))}
            </div>
          )
        })}
      {editingSection && itemDialog(editingSection)}
    </section>
  )
}
