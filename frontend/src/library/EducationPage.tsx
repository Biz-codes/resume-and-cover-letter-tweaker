// Library page for education: add entries, and open each one's dialog (EducationItem) to edit it,
// add a version of it, or delete it. Entries no section lists come first, so they can be listed
// again or deleted (docs/FRONTEND_CHECKS.md, "Unlisted items").
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { educationApi, educationLabel, type Education, type EducationFields } from '../shared/api/education'
import { distinctLabels } from '../shared/api/labels'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../shared/api/sections'
import FieldsForm from '../shared/components/FieldsForm'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { EDUCATION_FIELDS, educationLabels } from './items/itemFields'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import HiddenItems, { UnhideButton } from './HiddenItems'
import LibraryCard from './LibraryCard'
import { SORT_NOTE, sortByName } from '../shared/sortByName'
import { useUnhide } from './useUnhide'
import { offered } from '../shared/offered'
import AlertDialog from '../shared/components/Dialog/AlertDialog'

const EMPTY: EducationFields = { degree: '', institution: '', details: null, graduation: null }

// The New entry button, where focus returns when its form closes.
const NEW_ENTRY_ID = 'new-education'

export default function EducationPage() {
  const [entries, setEntries] = useState<Education[] | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [adding, setAdding] = useState(false)
  const [newSection, setNewSection] = useState(String(BUILT_IN_SECTION_IDS.education))
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

  const dialogs = useItemDialogs({ reload: load, notify: setNotice })
  const unhide = useUnhide(load, setNotice)

  async function create(fields: EducationFields) {
    const entry = await educationApi.create(fields, newSection ? Number(newSection) : null)
    setAdding(false)
    await load()
    setNotice(`Added "${educationLabel(entry)}".`)
    focusLater(editId('education', entry.education_id))
  }

  // Labels that tell versions apart (labels.ts): the full one, for buttons and the dialog, and
  // the card's title.
  const labelOf = educationLabels(entries ?? [])
  const titleOf = distinctLabels(entries ?? [], (item) => `${item.degree}, ${item.institution}`, (item) => item.created_at)

  // `hidden`: a card in the Hidden group, with Unhide.
  function card(entry: Education, hidden = false) {
    const label = labelOf(entry)
    return (
      <LibraryCard
        key={entry.education_id}
        title={titleOf(entry)}
        editId={editId('education', entry.education_id)}
        editLabel={`View and Edit "${label}"`}
        actions={hidden && <UnhideButton name={label} onUnhide={() => unhide('education', entry.education_id, label, () => educationApi.setHidden(entry.education_id, false))} />}
        onEdit={() => dialogs.open({ kind: 'education', id: entry.education_id, title: label })}
      >
        {entry.graduation && <p className="muted">{entry.graduation}</p>}
      </LibraryCard>
    )
  }

  const all = sortByName(entries ?? [], titleOf)
  const hiddenOnes = all.filter((entry) => entry.hidden)
  const sorted = all.filter((entry) => !entry.hidden)
  const listed = sorted.filter((entry) => entry.sections.length > 0)
  const unlisted = sorted.filter((entry) => entry.sections.length === 0)

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Education
      </h2>
      <p className="muted">
        Degrees, certificates, and other schooling. Write the degree with its field of study, and the graduation date
        with any honors, the way you want them printed.
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
      {!entries && !loadError && <p>Loading…</p>}

      {adding ? (
        <FieldsForm
          label="New education entry"
          fields={EDUCATION_FIELDS}
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
              {offered(sections).map((section) => (
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
          {unlisted.map((item) => card(item))}
        </div>
      )}
      {entries && <h3>Entries</h3>}
      {entries && listed.length === 0 && <p>No education yet.</p>}
      {listed.map((item) => card(item))}
      <HiddenItems count={hiddenOnes.length}>{hiddenOnes.map((entry) => card(entry, true))}</HiddenItems>
      {dialogs.dialog}
    </section>
  )
}
