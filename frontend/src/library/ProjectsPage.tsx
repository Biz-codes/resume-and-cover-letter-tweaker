// Library page for projects: add projects, and open each one's dialog (ItemDialog) to edit it,
// add a version of it, delete it, and edit its ordered skill and bullet lists. Editing follows "Changing a role or project" in
// docs/FRONTEND_CHECKS.md: sent versions never change, and resumes and cover letters in
// progress change only if the user says so; otherwise the change is a new version.
import { useCallback, useEffect, useState } from 'react'
import { bulletsApi, shortBullet, type Bullet } from '../shared/api/bullets'
import { toApiError, type ApiError } from '../shared/api/client'
import { projectLabel, projectsApi, type Project, type ProjectFields } from '../shared/api/projects'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../shared/api/sections'
import { skillsApi, type Skill } from '../shared/api/skills'
import { anyLocked } from '../shared/api/usage'
import ApplyChoice from './ApplyChoice'
import BulletList from './BulletList'
import Collapsible from './Collapsible/Collapsible'
import ConfirmDelete from '../shared/components/ConfirmDelete'
import FieldsForm, { type Field } from '../shared/components/FieldsForm'
import ItemDialog from './ItemDialog'
import LibraryCard from './LibraryCard'
import NameList from './NameList'
import OrderedList from '../shared/components/OrderedList/OrderedList'
import UsedBy from './UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { distinctLabels } from '../shared/api/labels'

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

const SENT_NOTE = 'A sent version uses this project, so saving adds a new version. The sent version keeps this one.'

// Ids of the buttons that open a form or dialog, where focus returns when it closes.
const NEW_PROJECT_ID = 'new-project'
const editId = (id: number) => `project-${id}-edit`

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
  const [adding, setAdding] = useState(false)
  // The project whose dialog is open.
  const [editing, setEditing] = useState<number | null>(null)
  const [applyToUnsent, setApplyToUnsent] = useState(false)
  const [newSection, setNewSection] = useState(String(BUILT_IN_SECTION_IDS.projects))
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Said in the dialog, for a change that keeps it open (something new written in it).
  const [dialogNotice, setDialogNotice] = useState<string | null>(null)
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

  function openItem(id: number) {
    setEditing(id)
    setDialogNotice(null)
    setApplyToUnsent(false)
    setDeleteError(null)
    setNotice(null)
  }

  async function saved(project: Project, message: string) {
    setAdding(false)
    setEditing(null)
    await load()
    setNotice(message)
    focusLater(editId(project.project_id))
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
      setEditing(null)
      focusLater(PAGE_HEADING_ID)
      await load()
      setNotice(`Deleted "${projectLabel(project)}".`)
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

  // Labels that tell versions apart (labels.ts): the full one, for buttons and forms, and the
  // card's title.
  const labelOf = distinctLabels(projects ?? [], projectLabel, (item) => item.created_at)
  const titleOf = distinctLabels(projects ?? [], (item) => item.project_title, (item) => item.created_at)

  function card(project: Project) {
    return (
      <LibraryCard
        key={project.project_id}
        title={titleOf(project)}
        editId={editId(project.project_id)}
        editLabel={`Edit "${labelOf(project)}"`}
        onEdit={() => openItem(project.project_id)}
      >
        <p className="muted">{[project.done_for, project.dates].filter(Boolean).join(' | ')}</p>
        {project.url && <p className="muted">{project.url}</p>}
      </LibraryCard>
    )
  }

  function itemDialog(project: Project) {
    const label = labelOf(project)
    const inProgress = project.used_by.filter((use) => !use.locked)
    return (
      <ItemDialog
        notice={dialogNotice}
        title={label}
        onClose={() => setEditing(null)}
        form={
          <FieldsForm
            label={`Edit "${label}"`}
            fields={FIELDS}
            initial={fieldsOf(project)}
            note={anyLocked(project.used_by) ? SENT_NOTE : undefined}
            onSave={(fields) => update(project, fields, inProgress.length > 0)}
            onCancel={() => setEditing(null)}
          >
            {inProgress.length > 0 && <ApplyChoice uses={inProgress} apply={applyToUnsent} onChange={setApplyToUnsent} />}
          </FieldsForm>
        }
        newVersion={(back) => (
          <FieldsForm
            label={`New version of "${label}"`}
            fields={FIELDS}
            initial={fieldsOf(project)}
            submitLabel="Add version"
            onSave={(fields) => addVersion(project, fields)}
            onCancel={back}
          />
        )}
        confirmDelete={(back) => (
          <ConfirmDelete
            what={`"${label}"`}
            uses={project.used_by}
            effect="It's removed from them, along with its skills and bullets there. The skills and bullets stay in the library."
            error={deleteError}
            onConfirm={() => void confirmDelete(project)}
            onCancel={back}
          />
        )}
      >
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
            setDialogNotice(`Added the bullet "${shortBullet(content)}".`)
          }}
        />
        <NameList title="Sections that list it" names={project.sections.map((section) => section.title)} />
        <UsedBy uses={project.used_by} />
      </ItemDialog>
    )
  }

  const editingProject = projects?.find((project) => project.project_id === editing)
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

      {adding ? (
        <FieldsForm
          label="New project"
          fields={FIELDS}
          initial={EMPTY}
          submitLabel="Add project"
          onSave={create}
          onCancel={() => {
            setAdding(false)
            focusLater(NEW_PROJECT_ID)
          }}
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
          <button
            type="button"
            id={NEW_PROJECT_ID}
            onClick={() => {
              setAdding(true)
              setNotice(null)
            }}
          >
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
      {editingProject && itemDialog(editingProject)}
    </section>
  )
}
