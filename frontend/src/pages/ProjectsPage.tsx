// Library page for projects: add, edit, add a version of, and delete projects, and edit each
// project's ordered skill and bullet lists. Editing follows "Changing a role or project" in
// docs/FRONTEND_CHECKS.md: sent versions never change, and resumes and cover letters in
// progress change only if the user says so; otherwise the change is a new version.
import { useCallback, useEffect, useState } from 'react'
import { bulletsApi, type Bullet } from '../api/bullets'
import { toApiError, type ApiError } from '../api/client'
import { projectLabel, projectsApi, type Project, type ProjectFields } from '../api/projects'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../api/sections'
import { skillsApi, type Skill } from '../api/skills'
import { anyLocked } from '../api/usage'
import ApplyChoice from '../components/ApplyChoice'
import BulletList from '../components/BulletList'
import Collapsible from '../components/Collapsible'
import ConfirmDelete from '../components/ConfirmDelete'
import FieldsForm, { type Field } from '../components/FieldsForm'
import NameList from '../components/NameList'
import OrderedList from '../components/OrderedList'
import UsedBy from '../components/UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

const FIELDS: Field<ProjectFields>[] = [
  { name: 'project_title', label: 'Project title', required: true },
  {
    name: 'done_for',
    label: 'Affiliation (e.g. McGraw Hill, Freelance, Independent project)',
  },
  { name: 'url', label: 'Link', type: 'url' },
  { name: 'dates', label: 'Dates (as printed, e.g. Spring 2024)' },
]

const EMPTY: ProjectFields = {
  project_title: '',
  done_for: null,
  url: null,
  dates: null,
}

const VERSION_NOTE =
  'Adds a new version listing the same skills and bullets. This one stays as it is, and resumes and cover letters keep the version they use until you pick another.'

const SENT_NOTE =
  'A sent version uses this project, so your change will be saved as a new version. Sent versions keep this one.'

// Which form is open: a new project, or editing a project or adding a version of it.
type Form = { kind: 'new' } | { kind: 'edit' | 'version'; id: number }

// Ids of the buttons that open a form, where focus returns when it closes.
const NEW_PROJECT_ID = 'new-project'
const buttonId = (id: number, action: 'edit' | 'version' | 'delete') => `project-${id}-${action}`

function fieldsOf(project: Project): ProjectFields {
  return {
    project_title: project.project_title,
    done_for: project.done_for,
    url: project.url,
    dates: project.dates,
  }
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [bullets, setBullets] = useState<Bullet[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [applyToUnsent, setApplyToUnsent] = useState(false)
  const [newSection, setNewSection] = useState(String(BUILT_IN_SECTION_IDS.projects))
  const [deleting, setDeleting] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Projects')

  const load = useCallback(
    () =>
      Promise.all([projectsApi.list(), skillsApi.list(), bulletsApi.list(), sectionsApi.list()])
        .then(([projectList, skillList, bulletList, sectionList]) => {
          setProjects(projectList)
          setSkills(skillList)
          setBullets(bulletList)
          setSections(sectionList)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  function open(next: Form) {
    setForm(next)
    setApplyToUnsent(false)
    setNotice(null)
    setDeleting(null)
  }

  function close(returnTo: string) {
    setForm(null)
    focusLater(returnTo)
  }

  async function saved(project: Project, message: string) {
    setForm(null)
    setNotice(message)
    await load()
    focusLater(buttonId(project.project_id, 'edit'))
  }

  async function create(fields: ProjectFields) {
    const project = await projectsApi.create(fields, newSection ? Number(newSection) : null)
    await saved(project, `Added "${projectLabel(project)}".`)
  }

  async function update(original: Project, fields: ProjectFields, inProgress: boolean) {
    const project = await projectsApi.update(original.project_id, fields, applyToUnsent)
    const changedThem = inProgress && applyToUnsent
    let message = 'Saved.'
    if (project.project_id !== original.project_id) {
      message = changedThem
        ? `Saved as a new version, "${projectLabel(project)}". Resumes and cover letters in progress use it now; sent ones keep "${projectLabel(original)}".`
        : `Saved as a new version, "${projectLabel(project)}". Everything that used "${projectLabel(original)}" still does; pick the new version where you want it.`
    }
    await saved(project, message)
  }

  async function addVersion(original: Project, fields: ProjectFields) {
    const project = await projectsApi.addVersion(original.project_id, fields)
    await saved(
      project,
      project.project_id === original.project_id
        ? 'Nothing changed, so no new version was added.'
        : `Added a new version, "${projectLabel(project)}". Resumes and cover letters keep "${projectLabel(original)}" until you pick the new one.`,
    )
  }

  async function confirmDelete(project: Project) {
    setDeleteError(null)
    try {
      await projectsApi.delete(project.project_id)
      setDeleting(null)
      focusLater(PAGE_HEADING_ID)
      setNotice(`Deleted "${projectLabel(project)}".`)
      await load()
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  const allBullets = bullets.map((bullet) => ({
    bullet_id: bullet.bullet_id,
    content: bullet.content,
  }))
  const skillChoices = skills.map((skill) => ({
    id: skill.skill_id,
    name: skill.skill_name,
  }))

  function card(project: Project) {
    const label = projectLabel(project)
    if (form?.kind === 'edit' && form.id === project.project_id) {
      const inProgress = project.used_by.filter((use) => !use.locked)
      return (
        <FieldsForm
          key={project.project_id}
          label={`Edit "${label}"`}
          fields={FIELDS}
          initial={fieldsOf(project)}
          note={anyLocked(project.used_by) ? SENT_NOTE : undefined}
          onSave={(fields) => update(project, fields, inProgress.length > 0)}
          onCancel={() => close(buttonId(project.project_id, 'edit'))}
        >
          {inProgress.length > 0 && <ApplyChoice uses={inProgress} apply={applyToUnsent} onChange={setApplyToUnsent} />}
        </FieldsForm>
      )
    }
    return (
      <article key={project.project_id} className="card">
        <div className="card-header">
          <h4>{project.project_title}</h4>
          {deleting !== project.project_id && (
            <div className="actions">
              <button
                type="button"
                id={buttonId(project.project_id, 'edit')}
                aria-label={`Edit "${label}"`}
                onClick={() => open({ kind: 'edit', id: project.project_id })}
              >
                Edit
              </button>
              <button
                type="button"
                id={buttonId(project.project_id, 'version')}
                aria-label={`New version of "${label}"`}
                onClick={() => open({ kind: 'version', id: project.project_id })}
              >
                New version
              </button>
              <button
                type="button"
                id={buttonId(project.project_id, 'delete')}
                aria-label={`Delete "${label}"`}
                onClick={() => {
                  setDeleting(project.project_id)
                  setDeleteError(null)
                  setForm(null)
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
        <p className="muted">{[project.done_for, project.dates].filter(Boolean).join(' | ')}</p>
        {project.url && <p className="muted">{project.url}</p>}
        {deleting === project.project_id && (
          <ConfirmDelete
            what={`"${label}"`}
            uses={project.used_by}
            effect="It's removed from them, along with its skills and bullets there. The skills and bullets stay in the library."
            error={deleteError}
            onConfirm={() => void confirmDelete(project)}
            onCancel={() => {
              setDeleting(null)
              focusLater(buttonId(project.project_id, 'delete'))
            }}
          />
        )}
        {form?.kind === 'version' && form.id === project.project_id && (
          <FieldsForm
            label={`New version of "${label}"`}
            fields={FIELDS}
            initial={fieldsOf(project)}
            note={VERSION_NOTE}
            submitLabel="Add version"
            onSave={(fields) => addVersion(project, fields)}
            onCancel={() => close(buttonId(project.project_id, 'version'))}
          />
        )}
        <Collapsible title="Skills" count={project.skills.length}>
          <OrderedList
            label={`${label} skills`}
            items={project.skills.map((skill) => ({
              id: skill.skill_id,
              name: skill.skill_name,
            }))}
            choices={skillChoices}
            emptyText="No skills yet."
            onChange={async (ids) => {
              await projectsApi.setSkills(project.project_id, ids)
              await load()
            }}
          />
        </Collapsible>
        <BulletList
          owner={label}
          bullets={project.bullets}
          allBullets={allBullets}
          onChange={async (ids) => {
            await projectsApi.setBullets(project.project_id, ids)
            await load()
          }}
          onWrite={async (content) => {
            await bulletsApi.create(content, {
              project_id: project.project_id,
            })
            await load()
          }}
        />
        <NameList title="Sections that list it" names={project.sections.map((section) => section.title)} />
        <UsedBy uses={project.used_by} />
      </article>
    )
  }

  const listed = projects?.filter((project) => project.sections.length > 0) ?? []
  const unlisted = projects?.filter((project) => project.sections.length === 0) ?? []

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Projects
      </h2>
      <p className="muted">
        Projects, with the skills and bullets that can go under each one. Each version of a project (a new title, or
        dates written differently) is its own entry, and versions share skills and bullets.
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
      {!projects && !loadError && <p>Loading…</p>}

      {form?.kind === 'new' ? (
        <FieldsForm
          label="New project"
          fields={FIELDS}
          initial={EMPTY}
          submitLabel="Add project"
          onSave={create}
          onCancel={() => close(NEW_PROJECT_ID)}
        >
          <label>
            List it under
            <select value={newSection} onChange={(event) => setNewSection(event.target.value)}>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title}
                </option>
              ))}
              <option value="">No section</option>
            </select>
          </label>
        </FieldsForm>
      ) : (
        projects && (
          <button type="button" id={NEW_PROJECT_ID} onClick={() => open({ kind: 'new' })}>
            New project
          </button>
        )
      )}

      {unlisted.length > 0 && (
        <div className="section-group">
          <h3>Not listed under any section</h3>
          <p className="muted">List these under a section on the Sections page, or delete them.</p>
          {unlisted.map(card)}
        </div>
      )}
      {projects && <h3>Projects</h3>}
      {projects && listed.length === 0 && <p>No projects yet.</p>}
      {listed.map(card)}
    </section>
  )
}
