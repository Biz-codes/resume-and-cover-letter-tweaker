// Library page for experience (roles): add roles, and open each one's dialog (ItemDialog) to edit
// it, add a version of it, delete it, and edit its ordered bullet list. Editing follows "Changing a role or project" in
// docs/FRONTEND_CHECKS.md: sent versions never change, and resumes and cover letters in
// progress change only if the user says so; otherwise the change is a new version.
import { useCallback, useEffect, useState } from 'react'
import { bulletsApi, shortBullet, type Bullet } from '../shared/api/bullets'
import { toApiError, type ApiError } from '../shared/api/client'
import { experienceLabel, experienceApi, type Experience, type ExperienceFields } from '../shared/api/experience'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../shared/api/sections'
import { anyLocked } from '../shared/api/usage'
import ApplyChoice from './ApplyChoice'
import BulletList from './BulletList'
import ConfirmDelete from '../shared/components/ConfirmDelete'
import FieldsForm, { type Field } from '../shared/components/FieldsForm'
import ItemDialog from './ItemDialog'
import LibraryCard from './LibraryCard'
import NameList from './NameList'
import UsedBy from './UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { distinctLabels } from '../shared/api/labels'

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

const SENT_NOTE = 'A sent version uses this role, so saving adds a new version. The sent version keeps this one.'

// Ids of the buttons that open a form or dialog, where focus returns when it closes.
const NEW_ROLE_ID = 'new-role'
const editId = (id: number) => `role-${id}-edit`

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
  const [adding, setAdding] = useState(false)
  // The role whose dialog is open.
  const [editing, setEditing] = useState<number | null>(null)
  const [applyToUnsent, setApplyToUnsent] = useState(false)
  const [newSection, setNewSection] = useState(String(BUILT_IN_SECTION_IDS.experience))
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Said in the dialog, for a change that keeps it open (something new written in it).
  const [dialogNotice, setDialogNotice] = useState<string | null>(null)
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

  function openItem(id: number) {
    setEditing(id)
    setDialogNotice(null)
    setApplyToUnsent(false)
    setDeleteError(null)
    setNotice(null)
  }

  async function saved(role: Experience, message: string) {
    setAdding(false)
    setEditing(null)
    await load()
    setNotice(message)
    focusLater(editId(role.experience_id))
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
      setEditing(null)
      focusLater(PAGE_HEADING_ID)
      await load()
      setNotice(`Deleted "${experienceLabel(role)}".`)
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  const allBullets = bullets.map((bullet) => ({
    bullet_id: bullet.bullet_id,
    content: bullet.content,
  }))

  // Labels that tell versions apart (labels.ts): the full one, for buttons and forms, and the
  // card's title.
  const labelOf = distinctLabels(roles ?? [], experienceLabel, (item) => item.created_at)
  const titleOf = distinctLabels(roles ?? [], (item) => `${item.role_title}, ${item.organization}`, (item) => item.created_at)

  function card(role: Experience) {
    return (
      <LibraryCard
        key={role.experience_id}
        title={titleOf(role)}
        editId={editId(role.experience_id)}
        editLabel={`Edit "${labelOf(role)}"`}
        onEdit={() => openItem(role.experience_id)}
      >
        <p className="muted">{[role.location, role.dates].filter(Boolean).join(' | ')}</p>
      </LibraryCard>
    )
  }

  function itemDialog(role: Experience) {
    const label = labelOf(role)
    const inProgress = role.used_by.filter((use) => !use.locked)
    return (
      <ItemDialog
        notice={dialogNotice}
        title={label}
        onClose={() => setEditing(null)}
        form={
          <FieldsForm
            label={`Edit "${label}"`}
            fields={FIELDS}
            initial={fieldsOf(role)}
            note={anyLocked(role.used_by) ? SENT_NOTE : undefined}
            onSave={(fields) => update(role, fields, inProgress.length > 0)}
            onCancel={() => setEditing(null)}
          >
            {inProgress.length > 0 && <ApplyChoice uses={inProgress} apply={applyToUnsent} onChange={setApplyToUnsent} />}
          </FieldsForm>
        }
        newVersion={(back) => (
          <FieldsForm
            label={`New version of "${label}"`}
            fields={FIELDS}
            initial={fieldsOf(role)}
            submitLabel="Add version"
            onSave={(fields) => addVersion(role, fields)}
            onCancel={back}
          />
        )}
        confirmDelete={(back) => (
          <ConfirmDelete
            what={`"${label}"`}
            uses={role.used_by}
            effect="It's removed from them, along with its bullets there. The bullets stay in the library."
            error={deleteError}
            onConfirm={() => void confirmDelete(role)}
            onCancel={back}
          />
        )}
      >
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
            setDialogNotice(`Added the bullet "${shortBullet(content)}".`)
          }}
        />
        <NameList title="Sections that list it" names={role.sections.map((section) => section.title)} />
        <UsedBy uses={role.used_by} />
      </ItemDialog>
    )
  }

  const editingRole = roles?.find((role) => role.experience_id === editing)
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

      {adding ? (
        <FieldsForm
          label="New role"
          fields={FIELDS}
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
      {editingRole && itemDialog(editingRole)}
    </section>
  )
}
