// Library page for projects: add projects, and open each one's dialog (ProjectItem) to edit it,
// add a version of it, delete it, and edit its skills and bullets.
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { distinctLabels } from '../shared/api/labels'
import { projectLabel, projectsApi, type Project, type ProjectFields } from '../shared/api/projects'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../shared/api/sections'
import FieldsForm from '../shared/components/FieldsForm'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import { PROJECT_FIELDS, projectLabels } from './items/itemFields'
import HiddenItems, { UnhideButton } from './HiddenItems'
import LibraryCard from './LibraryCard'
import { SORT_NOTE, sortByName } from '../shared/sortByName'
import { useUnhide } from './useUnhide'
import { offered } from '../shared/offered'
import AlertDialog from '../shared/components/Dialog/AlertDialog'

const EMPTY: ProjectFields = {
  project_title: '',
  done_for: null,
  url: null,
  dates: null,
}

// The New project button, where focus returns when its form closes.
const NEW_PROJECT_ID = 'new-project'

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [adding, setAdding] = useState(false)
  const [newSection, setNewSection] = useState(String(BUILT_IN_SECTION_IDS.projects))
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Projects')

  const load = useCallback(
    () =>
      Promise.all([projectsApi.list(), sectionsApi.list()])
        .then(([projectList, sectionList]) => {
          setProjects(projectList)
          setSections(sectionList)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const dialogs = useItemDialogs({ reload: load, notify: setNotice })
  const unhide = useUnhide(load, setNotice)

  async function create(fields: ProjectFields) {
    const project = await projectsApi.create(fields, newSection ? Number(newSection) : null)
    setAdding(false)
    await load()
    setNotice(`Added "${projectLabel(project)}".`)
    focusLater(editId('project', project.project_id))
  }

  // Labels that tell versions apart (labels.ts): the full one, for buttons and the dialog, and
  // the card's title.
  const labelOf = projectLabels(projects ?? [])
  const titleOf = distinctLabels(projects ?? [], (item) => item.project_title, (item) => item.created_at)

  // `hidden`: a card in the Hidden group, with Unhide.
  function card(project: Project, hidden = false) {
    const label = labelOf(project)
    return (
      <LibraryCard
        key={project.project_id}
        title={titleOf(project)}
        editId={editId('project', project.project_id)}
        editLabel={`View and Edit "${label}"`}
        actions={hidden && <UnhideButton name={label} onUnhide={() => unhide('project', project.project_id, label, () => projectsApi.setHidden(project.project_id, false))} />}
        onEdit={() => dialogs.open({ kind: 'project', id: project.project_id, title: label })}
      >
        <p className="muted">{[project.done_for, project.dates].filter(Boolean).join(' | ')}</p>
        {project.url && <p className="muted">{project.url}</p>}
      </LibraryCard>
    )
  }

  const all = sortByName(projects ?? [], titleOf)
  const hiddenOnes = all.filter((project) => project.hidden)
  const sorted = all.filter((project) => !project.hidden)
  const listed = sorted.filter((project) => project.sections.length > 0)
  const unlisted = sorted.filter((project) => project.sections.length === 0)

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Projects
      </h2>
      <p className="muted">
        Projects, with the skills and bullets that can go under each one. Each version of a project (a new title, or
        dates written differently) is its own entry, and versions share skills and bullets.
      </p>
      <p className="muted">{SORT_NOTE}</p>
      <AlertDialog message={notice} onClose={() => setNotice(null)} />
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
          fields={PROJECT_FIELDS}
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
              {sortByName(offered(sections), (section) => section.title).map((section) => (
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
          {unlisted.map((item) => card(item))}
        </div>
      )}
      {projects && <h3>Projects</h3>}
      {projects && listed.length === 0 && <p>No projects yet.</p>}
      {listed.map((item) => card(item))}
      <HiddenItems count={hiddenOnes.length}>{hiddenOnes.map((project) => card(project, true))}</HiddenItems>
      {dialogs.dialog}
    </section>
  )
}
