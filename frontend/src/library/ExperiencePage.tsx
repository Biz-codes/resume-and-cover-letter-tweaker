// Library page for experience (roles): add roles, and open each one's dialog (ExperienceItem) to
// edit it, add a version of it, delete it, and edit its bullets.
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { experienceApi, experienceLabel, type Experience, type ExperienceFields } from '../shared/api/experience'
import { distinctLabels } from '../shared/api/labels'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../shared/api/sections'
import FieldsForm from '../shared/components/FieldsForm'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { ROLE_FIELDS, roleLabels } from './items/itemFields'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import LibraryCard from './LibraryCard'
import { SORT_NOTE, sortByName } from '../shared/sortByName'

const EMPTY: ExperienceFields = {
  role_title: '',
  organization: '',
  location: null,
  dates: null,
}

// The New role button, where focus returns when its form closes.
const NEW_ROLE_ID = 'new-role'

export default function ExperiencePage() {
  const [roles, setRoles] = useState<Experience[] | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [adding, setAdding] = useState(false)
  const [newSection, setNewSection] = useState(String(BUILT_IN_SECTION_IDS.experience))
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Experience')

  const load = useCallback(
    () =>
      Promise.all([experienceApi.list(), sectionsApi.list()])
        .then(([roleList, sectionList]) => {
          setRoles(roleList)
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

  async function create(fields: ExperienceFields) {
    const role = await experienceApi.create(fields, newSection ? Number(newSection) : null)
    setAdding(false)
    await load()
    setNotice(`Added "${experienceLabel(role)}".`)
    focusLater(editId('experience', role.experience_id))
  }

  // Labels that tell versions apart (labels.ts): the full one, for buttons and the dialog, and
  // the card's title.
  const labelOf = roleLabels(roles ?? [])
  const titleOf = distinctLabels(roles ?? [], (item) => `${item.role_title}, ${item.organization}`, (item) => item.created_at)

  function card(role: Experience) {
    const label = labelOf(role)
    return (
      <LibraryCard
        key={role.experience_id}
        title={titleOf(role)}
        editId={editId('experience', role.experience_id)}
        editLabel={`View and Edit "${label}"`}
        onEdit={() => dialogs.open({ kind: 'experience', id: role.experience_id, title: label })}
      >
        <p className="muted">{[role.location, role.dates].filter(Boolean).join(' | ')}</p>
      </LibraryCard>
    )
  }

  const sorted = sortByName(roles ?? [], titleOf)
  const listed = sorted.filter((role) => role.sections.length > 0)
  const unlisted = sorted.filter((role) => role.sections.length === 0)

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Experience
      </h2>
      <p className="muted">
        Roles (paid jobs, volunteer work, or anything else) and the bullets that can go under each one. Each version of
        a role (a new title, or dates written differently) is its own entry, and versions share bullets.
      </p>
      <p className="muted">{SORT_NOTE}</p>
      <p role="status">{notice}</p>
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!roles && !loadError && <p>Loading…</p>}

      {adding ? (
        <FieldsForm
          label="New role"
          fields={ROLE_FIELDS}
          initial={EMPTY}
          submitLabel="Add role"
          onSave={create}
          onCancel={() => {
            setAdding(false)
            focusLater(NEW_ROLE_ID)
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
        roles && (
          <button
            type="button"
            id={NEW_ROLE_ID}
            onClick={() => {
              setAdding(true)
              setNotice(null)
            }}
          >
            New role
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
      {roles && <h3>Roles</h3>}
      {roles && listed.length === 0 && <p>No roles yet.</p>}
      {listed.map(card)}
      {dialogs.dialog}
    </section>
  )
}
