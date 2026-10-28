// Library page for experience (roles): add, edit, add a version of, and delete roles, and
// edit each role's ordered bullet list. Editing follows "Changing a role or project" in
// docs/FRONTEND_CHECKS.md: sent versions never change, and resumes and cover letters in
// progress change only if the user says so; otherwise the change is a new version.
import { useCallback, useEffect, useState } from 'react'
import { bulletsApi, type Bullet } from '../api/bullets'
import { toApiError, type ApiError } from '../api/client'
import { experienceLabel, experienceApi, type Experience, type ExperienceFields } from '../api/experience'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../api/sections'
import { anyLocked } from '../api/usage'
import ApplyChoice from '../components/ApplyChoice'
import BulletList from '../components/BulletList'
import ConfirmDelete from '../components/ConfirmDelete'
import FieldsForm, { type Field } from '../components/FieldsForm'
import NameList from '../components/NameList'
import UsedBy from '../components/UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

const FIELDS: Field<ExperienceFields>[] = [
  { name: 'role_title', label: 'Title', required: true },
  { name: 'organization', label: 'Organization', required: true },
  { name: 'location', label: 'Location' },
  { name: 'dates', label: 'Dates (as printed, e.g. Jan 2020 – Present)' },
]

const EMPTY: ExperienceFields = {
  role_title: '',
  organization: '',
  location: null,
  dates: null,
}

const VERSION_NOTE =
  'Adds a new version listing the same bullets. This one stays as it is, and resumes and cover letters keep the version they use until you pick another.'

const SENT_NOTE =
  'A sent version uses this role, so your change will be saved as a new version. Sent versions keep this one.'

// Which form is open: a new role, or editing a role or adding a version of it.
type Form = { kind: 'new' } | { kind: 'edit' | 'version'; id: number }

// Ids of the buttons that open a form, where focus returns when it closes.
const NEW_ROLE_ID = 'new-role'
const buttonId = (id: number, action: 'edit' | 'version' | 'delete') => `role-${id}-${action}`

function fieldsOf(role: Experience): ExperienceFields {
  return {
    role_title: role.role_title,
    organization: role.organization,
    location: role.location,
    dates: role.dates,
  }
}

export default function ExperiencePage() {
  const [roles, setRoles] = useState<Experience[] | null>(null)
  const [bullets, setBullets] = useState<Bullet[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [applyToUnsent, setApplyToUnsent] = useState(false)
  const [newSection, setNewSection] = useState(String(BUILT_IN_SECTION_IDS.experience))
  const [deleting, setDeleting] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Experience')

  const load = useCallback(
    () =>
      Promise.all([experienceApi.list(), bulletsApi.list(), sectionsApi.list()])
        .then(([roleList, bulletList, sectionList]) => {
          setRoles(roleList)
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

  async function saved(role: Experience, message: string) {
    setForm(null)
    setNotice(message)
    await load()
    focusLater(buttonId(role.experience_id, 'edit'))
  }

  async function create(fields: ExperienceFields) {
    const role = await experienceApi.create(fields, newSection ? Number(newSection) : null)
    await saved(role, `Added "${experienceLabel(role)}".`)
  }

  async function update(original: Experience, fields: ExperienceFields, inProgress: boolean) {
    const role = await experienceApi.update(original.experience_id, fields, applyToUnsent)
    const changedThem = inProgress && applyToUnsent
    let message = 'Saved.'
    if (role.experience_id !== original.experience_id) {
      message = changedThem
        ? `Saved as a new version, "${experienceLabel(role)}". Resumes and cover letters in progress use it now; sent ones keep "${experienceLabel(original)}".`
        : `Saved as a new version, "${experienceLabel(role)}". Everything that used "${experienceLabel(original)}" still does; pick the new version where you want it.`
    }
    await saved(role, message)
  }

  async function addVersion(original: Experience, fields: ExperienceFields) {
    const role = await experienceApi.addVersion(original.experience_id, fields)
    await saved(
      role,
      role.experience_id === original.experience_id
        ? 'Nothing changed, so no new version was added.'
        : `Added a new version, "${experienceLabel(role)}". Resumes and cover letters keep "${experienceLabel(original)}" until you pick the new one.`,
    )
  }

  async function confirmDelete(role: Experience) {
    setDeleteError(null)
    try {
      await experienceApi.delete(role.experience_id)
      setDeleting(null)
      focusLater(PAGE_HEADING_ID)
      setNotice(`Deleted "${experienceLabel(role)}".`)
      await load()
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  const allBullets = bullets.map((bullet) => ({
    bullet_id: bullet.bullet_id,
    content: bullet.content,
  }))

  function card(role: Experience) {
    const label = experienceLabel(role)
    if (form?.kind === 'edit' && form.id === role.experience_id) {
      const inProgress = role.used_by.filter((use) => !use.locked)
      return (
        <FieldsForm
          key={role.experience_id}
          label={`Edit "${label}"`}
          fields={FIELDS}
          initial={fieldsOf(role)}
          note={anyLocked(role.used_by) ? SENT_NOTE : undefined}
          onSave={(fields) => update(role, fields, inProgress.length > 0)}
          onCancel={() => close(buttonId(role.experience_id, 'edit'))}
        >
          {inProgress.length > 0 && <ApplyChoice uses={inProgress} apply={applyToUnsent} onChange={setApplyToUnsent} />}
        </FieldsForm>
      )
    }
    return (
      <article key={role.experience_id} className="card">
        <div className="card-header">
          <h4>
            {role.role_title}, {role.organization}
          </h4>
          {deleting !== role.experience_id && (
            <div className="actions">
              <button
                type="button"
                id={buttonId(role.experience_id, 'edit')}
                aria-label={`Edit "${label}"`}
                onClick={() => open({ kind: 'edit', id: role.experience_id })}
              >
                Edit
              </button>
              <button
                type="button"
                id={buttonId(role.experience_id, 'version')}
                aria-label={`New version of "${label}"`}
                onClick={() => open({ kind: 'version', id: role.experience_id })}
              >
                New version
              </button>
              <button
                type="button"
                id={buttonId(role.experience_id, 'delete')}
                aria-label={`Delete "${label}"`}
                onClick={() => {
                  setDeleting(role.experience_id)
                  setDeleteError(null)
                  setForm(null)
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
        <p className="muted">{[role.location, role.dates].filter(Boolean).join(' | ')}</p>
        {deleting === role.experience_id && (
          <ConfirmDelete
            what={`"${label}"`}
            uses={role.used_by}
            effect="It's removed from them, along with its bullets there. The bullets stay in the library."
            error={deleteError}
            onConfirm={() => void confirmDelete(role)}
            onCancel={() => {
              setDeleting(null)
              focusLater(buttonId(role.experience_id, 'delete'))
            }}
          />
        )}
        {form?.kind === 'version' && form.id === role.experience_id && (
          <FieldsForm
            label={`New version of "${label}"`}
            fields={FIELDS}
            initial={fieldsOf(role)}
            note={VERSION_NOTE}
            submitLabel="Add version"
            onSave={(fields) => addVersion(role, fields)}
            onCancel={() => close(buttonId(role.experience_id, 'version'))}
          />
        )}
        <BulletList
          owner={label}
          bullets={role.bullets}
          allBullets={allBullets}
          onChange={async (ids) => {
            await experienceApi.setBullets(role.experience_id, ids)
            await load()
          }}
          onWrite={async (content) => {
            await bulletsApi.create(content, {
              experience_id: role.experience_id,
            })
            await load()
          }}
        />
        <NameList title="Sections that list it" names={role.sections.map((section) => section.title)} />
        <UsedBy uses={role.used_by} />
      </article>
    )
  }

  const listed = roles?.filter((role) => role.sections.length > 0) ?? []
  const unlisted = roles?.filter((role) => role.sections.length === 0) ?? []

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Experience
      </h2>
      <p className="muted">
        Roles (paid jobs, volunteer work, or anything else) and the bullets that can go under each one. Each version of
        a role (a new title, or dates written differently) is its own entry, and versions share bullets.
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
      {!roles && !loadError && <p>Loading…</p>}

      {form?.kind === 'new' ? (
        <FieldsForm
          label="New role"
          fields={FIELDS}
          initial={EMPTY}
          submitLabel="Add role"
          onSave={create}
          onCancel={() => close(NEW_ROLE_ID)}
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
          <button type="button" id={NEW_ROLE_ID} onClick={() => open({ kind: 'new' })}>
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
    </section>
  )
}
