// Library page for sections: add, rename, delete, and edit which skill categories, roles,
// projects, and bullets each section lists. Built-in sections can't be renamed or deleted (docs/FRONTEND_CHECKS.md).
// Sections are grouped by whether their titles print: resume headings do, cover letter
// section titles are labels only the user sees (docs/DATABASE.md, section notes).
import { useCallback, useEffect, useState } from 'react'
import { bulletsApi, type Bullet } from '../api/bullets'
import { toApiError, type ApiError } from '../api/client'
import { experienceLabel, experienceApi, type Experience } from '../api/experience'
import { projectLabel, projectsApi, type Project } from '../api/projects'
import { sectionsApi, type Section } from '../api/sections'
import { skillCategoriesApi, type SkillCategory } from '../api/skills'
import { anyLocked } from '../api/usage'
import BulletList from '../components/BulletList'
import Collapsible from '../components/Collapsible'
import ConfirmDelete from '../components/ConfirmDelete'
import NameForm from '../components/NameForm'
import OrderedList from '../components/OrderedList'
import UsedBy from '../components/UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

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

const LOCKED_NOTE =
  'A sent version uses this section, so the new title will be saved as a new section. Sent versions keep the old title; unsent ones switch to the new one.'

export default function SectionsPage() {
  const [sections, setSections] = useState<Section[] | null>(null)
  const [categories, setCategories] = useState<SkillCategory[]>([])
  const [roles, setRoles] = useState<Experience[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [bullets, setBullets] = useState<Bullet[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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
      ])
        .then(([sectionList, categoryList, roleList, projectList, bulletList]) => {
          setSections(sectionList)
          setCategories(categoryList)
          setRoles(roleList)
          setProjects(projectList)
          setBullets(bulletList)
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
  const roleChoices = roles.map((role) => ({ id: role.experience_id, name: experienceLabel(role) }))
  const projectChoices = projects.map((project) => ({ id: project.project_id, name: projectLabel(project) }))
  const allBullets = bullets.map((bullet) => ({ bullet_id: bullet.bullet_id, content: bullet.content }))

  async function create(title: string) {
    await sectionsApi.create(title)
    setNotice(`Added "${title.trim()}".`)
    await load()
  }

  async function rename(section: Section, title: string) {
    const saved = await sectionsApi.rename(section.id, title)
    setRenaming(null)
    focusLater(`section-${saved.id}-rename`)
    setNotice(
      saved.id === section.id
        ? 'Saved.'
        : `Saved as a new section, "${saved.title}". Sent versions keep "${section.title}".`,
    )
    await load()
  }

  async function confirmDelete(section: Section) {
    setDeleteError(null)
    try {
      await sectionsApi.delete(section.id)
      setDeleting(null)
      focusLater(PAGE_HEADING_ID)
      setNotice(`Deleted "${section.title}".`)
      await load()
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

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
                <article key={section.id} className="card">
                  {renaming === section.id ? (
                    <NameForm
                      label="Section title"
                      field="title"
                      initial={section.title}
                      lockedNote={anyLocked(section.used_by) ? LOCKED_NOTE : undefined}
                      onSave={(title) => rename(section, title)}
                      onCancel={() => {
                        setRenaming(null)
                        focusLater(`section-${section.id}-rename`)
                      }}
                    />
                  ) : (
                    <h4>
                      {section.title}
                      {section.built_in && <span className="tag">built in</span>}
                      {group === 'resume' && section.used_by.some((use) => use.kind === 'cover_letter') && (
                        <span className="tag">also a cover letter label</span>
                      )}
                    </h4>
                  )}

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
                      items={section.experience.map((role) => ({ id: role.experience_id, name: experienceLabel(role) }))}
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
                        name: projectLabel(project),
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
                    }}
                  />

                  <UsedBy uses={section.used_by} />

                  {!section.built_in &&
                    renaming !== section.id &&
                    (deleting === section.id ? (
                      <ConfirmDelete
                        what={`"${section.title}"`}
                        uses={section.used_by}
                        effect="It and everything placed in it are removed from them. The library items it lists stay in the library."
                        error={deleteError}
                        onConfirm={() => void confirmDelete(section)}
                        onCancel={() => {
                          setDeleting(null)
                          focusLater(`section-${section.id}-delete`)
                        }}
                      />
                    ) : (
                      <div className="actions">
                        <button
                          type="button"
                          id={`section-${section.id}-rename`}
                          aria-label={`Rename "${section.title}"`}
                          onClick={() => setRenaming(section.id)}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          id={`section-${section.id}-delete`}
                          aria-label={`Delete "${section.title}"`}
                          onClick={() => {
                            setDeleting(section.id)
                            setDeleteError(null)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                </article>
              ))}
            </div>
          )
        })}
    </section>
  )
}
