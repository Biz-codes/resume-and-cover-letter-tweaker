// Library page for education: add entries, and open each one's dialog (ItemDialog) to edit it,
// add a version of it, or delete it. Editing an entry a sent version
// uses saves a new entry (docs/FRONTEND_CHECKS.md, "Sent versions are locked"). Entries no
// section lists come first, so they can be listed again or deleted ("Unlisted items").
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { educationApi, educationLabel, type Education, type EducationFields } from '../shared/api/education'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../shared/api/sections'
import { anyLocked } from '../shared/api/usage'
import ConfirmDelete from '../shared/components/ConfirmDelete'
import FieldsForm, { type Field } from '../shared/components/FieldsForm'
import ItemDialog from './ItemDialog'
import LibraryCard from './LibraryCard'
import NameList from './NameList'
import UsedBy from './UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { distinctLabels } from '../shared/api/labels'

const FIELDS: Field<EducationFields>[] = [
  { name: 'degree', label: 'Degree and field of study (e.g. B.A. in English)', required: true },
  { name: 'institution', label: 'School or institution', required: true },
  { name: 'graduation', label: 'Graduation and honors (as printed, e.g. May 2015, magna cum laude)' },
  { name: 'details', label: 'Details', multiline: true },
]

const EMPTY: EducationFields = { degree: '', institution: '', details: null, graduation: null }

const SENT_NOTE = 'A sent version uses this entry, so saving adds a new one. The sent version keeps this one.'

// Which form is open: a new entry, or editing one.
// Ids of the buttons that open a form or dialog, where focus returns when it closes.
const NEW_ENTRY_ID = 'new-education'
const editId = (id: number) => `education-${id}-edit`

function fieldsOf(entry: Education): EducationFields {
  return {
    degree: entry.degree,
    institution: entry.institution,
    details: entry.details,
    graduation: entry.graduation,
  }
}

export default function EducationPage() {
  const [entries, setEntries] = useState<Education[] | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [adding, setAdding] = useState(false)
  // The entry whose dialog is open.
  const [editing, setEditing] = useState<number | null>(null)
  const [newSection, setNewSection] = useState(String(BUILT_IN_SECTION_IDS.education))
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Education')

  const load = useCallback(
    () =>
      Promise.all([educationApi.list(), sectionsApi.list()])
        .then(([entryList, sectionList]) => {
          setEntries(entryList)
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
    setDeleteError(null)
    setNotice(null)
  }

  async function saved(entry: Education, message: string) {
    setAdding(false)
    setEditing(null)
    await load()
    setNotice(message)
    focusLater(editId(entry.education_id))
  }

  async function create(fields: EducationFields) {
    const entry = await educationApi.create(fields, newSection ? Number(newSection) : null)
    await saved(entry, `Added "${educationLabel(entry)}".`)
  }

  async function update(original: Education, fields: EducationFields) {
    const entry = await educationApi.update(original.education_id, fields)
    await saved(
      entry,
      entry.education_id === original.education_id
        ? 'Saved.'
        : `Saved as a new entry, "${educationLabel(entry)}", listed right after the original. Sent versions keep "${educationLabel(original)}".`,
    )
  }

  async function addVersion(original: Education, fields: EducationFields) {
    const entry = await educationApi.addVersion(original.education_id, fields)
    await saved(
      entry,
      entry.education_id === original.education_id
        ? 'Nothing changed, so no new version was added.'
        : `Added a new version, "${educationLabel(entry)}". Resumes and cover letters keep "${educationLabel(original)}" until you pick the new one.`,
    )
  }

  async function confirmDelete(entry: Education) {
    setDeleteError(null)
    try {
      await educationApi.delete(entry.education_id)
      setEditing(null)
      focusLater(PAGE_HEADING_ID)
      await load()
      setNotice(`Deleted "${educationLabel(entry)}".`)
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  // Labels that tell versions apart (labels.ts): the full one, for buttons and forms, and the
  // card's title.
  const labelOf = distinctLabels(entries ?? [], educationLabel, (item) => item.created_at)
  const titleOf = distinctLabels(entries ?? [], (item) => `${item.degree}, ${item.institution}`, (item) => item.created_at)

  function card(entry: Education) {
    return (
      <LibraryCard
        key={entry.education_id}
        title={titleOf(entry)}
        editId={editId(entry.education_id)}
        editLabel={`Edit "${labelOf(entry)}"`}
        onEdit={() => openItem(entry.education_id)}
      >
        {entry.graduation && <p className="muted">{entry.graduation}</p>}
      </LibraryCard>
    )
  }

  function itemDialog(entry: Education) {
    const label = labelOf(entry)
    return (
      <ItemDialog
        title={label}
        onClose={() => setEditing(null)}
        form={
          <FieldsForm
            label={`Edit "${label}"`}
            fields={FIELDS}
            initial={fieldsOf(entry)}
            note={anyLocked(entry.used_by) ? SENT_NOTE : undefined}
            onSave={(fields) => update(entry, fields)}
            onCancel={() => setEditing(null)}
          />
        }
        newVersion={(back) => (
          <FieldsForm
            label={`New version of "${label}"`}
            fields={FIELDS}
            initial={fieldsOf(entry)}
            submitLabel="Add version"
            onSave={(fields) => addVersion(entry, fields)}
            onCancel={back}
          />
        )}
        confirmDelete={(back) => (
          <ConfirmDelete
            what={`"${label}"`}
            uses={entry.used_by}
            effect="It's removed from them, and from every section."
            error={deleteError}
            onConfirm={() => void confirmDelete(entry)}
            onCancel={back}
          />
        )}
      >
        <NameList title="Sections that list it" names={entry.sections.map((section) => section.title)} />
        <UsedBy uses={entry.used_by} />
      </ItemDialog>
    )
  }

  const editingEntry = entries?.find((entry) => entry.education_id === editing)
  const listed = entries?.filter((entry) => entry.sections.length > 0) ?? []
  const unlisted = entries?.filter((entry) => entry.sections.length === 0) ?? []

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Education
      </h2>
      <p className="muted">
        Degrees, certificates, and other schooling. Write the degree with its field of study, and the graduation date
        with any honors, the way you want them printed.
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
      {!entries && !loadError && <p>Loading…</p>}

      {adding ? (
        <FieldsForm
          label="New education entry"
          fields={FIELDS}
          initial={EMPTY}
          submitLabel="Add entry"
          onSave={create}
          onCancel={() => {
            setAdding(false)
            focusLater(NEW_ENTRY_ID)
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
        entries && (
          <button
            type="button"
            id={NEW_ENTRY_ID}
            onClick={() => {
              setAdding(true)
              setNotice(null)
            }}
          >
            New entry
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
      {entries && <h3>Entries</h3>}
      {entries && listed.length === 0 && <p>No education yet.</p>}
      {listed.map(card)}
      {editingEntry && itemDialog(editingEntry)}
    </section>
  )
}
