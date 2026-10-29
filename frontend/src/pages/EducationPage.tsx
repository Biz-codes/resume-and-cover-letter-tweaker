// Library page for education: add, edit, and delete entries. Editing an entry a sent version
// uses saves a new entry (docs/FRONTEND_CHECKS.md, "Sent versions are locked"). Entries no
// section lists come first, so they can be listed again or deleted ("Unlisted items").
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../api/client'
import { educationApi, educationLabel, type Education, type EducationFields } from '../api/education'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../api/sections'
import { anyLocked } from '../api/usage'
import ConfirmDelete from '../components/ConfirmDelete'
import FieldsForm, { type Field } from '../components/FieldsForm'
import NameList from '../components/NameList'
import UsedBy from '../components/UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

const FIELDS: Field<EducationFields>[] = [
  { name: 'degree', label: 'Degree and field of study (e.g. B.A. in English)', required: true },
  { name: 'institution', label: 'School or institution', required: true },
  { name: 'graduation', label: 'Graduation and honors (as printed, e.g. May 2015, magna cum laude)' },
  { name: 'details', label: 'Details', multiline: true },
]

const EMPTY: EducationFields = { degree: '', institution: '', details: null, graduation: null }

const SENT_NOTE =
  'A sent version uses this entry, so your change will be saved as a new entry, listed right after this one. Sent versions keep this one; unsent ones switch to the new one.'

// Which form is open: a new entry, or editing one.
type Form = { kind: 'new' } | { kind: 'edit'; id: number }

// Ids of the buttons that open a form, where focus returns when it closes.
const NEW_ENTRY_ID = 'new-education'
const buttonId = (id: number, action: 'edit' | 'delete') => `education-${id}-${action}`

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
  const [form, setForm] = useState<Form | null>(null)
  const [newSection, setNewSection] = useState(String(BUILT_IN_SECTION_IDS.education))
  const [deleting, setDeleting] = useState<number | null>(null)
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

  function open(next: Form) {
    setForm(next)
    setNotice(null)
    setDeleting(null)
  }

  function close(returnTo: string) {
    setForm(null)
    focusLater(returnTo)
  }

  async function saved(entry: Education, message: string) {
    setForm(null)
    setNotice(message)
    await load()
    focusLater(buttonId(entry.education_id, 'edit'))
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

  async function confirmDelete(entry: Education) {
    setDeleteError(null)
    try {
      await educationApi.delete(entry.education_id)
      setDeleting(null)
      focusLater(PAGE_HEADING_ID)
      setNotice(`Deleted "${educationLabel(entry)}".`)
      await load()
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  function card(entry: Education) {
    const label = educationLabel(entry)
    if (form?.kind === 'edit' && form.id === entry.education_id) {
      return (
        <FieldsForm
          key={entry.education_id}
          label={`Edit "${label}"`}
          fields={FIELDS}
          initial={fieldsOf(entry)}
          note={anyLocked(entry.used_by) ? SENT_NOTE : undefined}
          onSave={(fields) => update(entry, fields)}
          onCancel={() => close(buttonId(entry.education_id, 'edit'))}
        />
      )
    }
    return (
      <article key={entry.education_id} className="card">
        <div className="card-header">
          <h4>
            {entry.degree}, {entry.institution}
          </h4>
          {deleting !== entry.education_id && (
            <div className="actions">
              <button
                type="button"
                id={buttonId(entry.education_id, 'edit')}
                aria-label={`Edit "${label}"`}
                onClick={() => open({ kind: 'edit', id: entry.education_id })}
              >
                Edit
              </button>
              <button
                type="button"
                id={buttonId(entry.education_id, 'delete')}
                aria-label={`Delete "${label}"`}
                onClick={() => {
                  setDeleting(entry.education_id)
                  setDeleteError(null)
                  setForm(null)
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
        {entry.graduation && <p className="muted">{entry.graduation}</p>}
        {entry.details && <p className="details">{entry.details}</p>}
        {deleting === entry.education_id && (
          <ConfirmDelete
            what={`"${label}"`}
            uses={entry.used_by}
            effect="It's removed from them, and from every section."
            error={deleteError}
            onConfirm={() => void confirmDelete(entry)}
            onCancel={() => {
              setDeleting(null)
              focusLater(buttonId(entry.education_id, 'delete'))
            }}
          />
        )}
        <NameList title="Sections that list it" names={entry.sections.map((section) => section.title)} />
        <UsedBy uses={entry.used_by} />
      </article>
    )
  }

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

      {form?.kind === 'new' ? (
        <FieldsForm
          label="New education entry"
          fields={FIELDS}
          initial={EMPTY}
          submitLabel="Add entry"
          onSave={create}
          onCancel={() => close(NEW_ENTRY_ID)}
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
          <button type="button" id={NEW_ENTRY_ID} onClick={() => open({ kind: 'new' })}>
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
    </section>
  )
}
