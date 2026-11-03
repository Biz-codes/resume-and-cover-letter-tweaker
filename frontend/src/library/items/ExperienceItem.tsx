// A role's dialog: edit it (following "Changing a role or project" in docs/FRONTEND_CHECKS.md:
// sent versions never change, and resumes and cover letters in progress change only if the user
// says so), add a version of it, delete it, and edit its ordered bullet list. Its bullets and
// sections open in the same dialog.
import { useState } from 'react'
import { bulletsApi, shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { experienceApi, experienceLabel, type Experience, type ExperienceFields } from '../../shared/api/experience'
import { anyLocked } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import FieldsForm from '../../shared/components/FieldsForm'
import ApplyChoice from '../ApplyChoice'
import BulletList from '../BulletList'
import NameList from '../NameList'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'
import { ROLE_FIELDS, roleLabels } from './itemFields'


const SENT_NOTE = 'A sent version uses this role, so saving adds a new version. The sent version keeps this one.'

const fieldsOf = (role: Experience): ExperienceFields => ({
  role_title: role.role_title,
  organization: role.organization,
  location: role.location,
  dates: role.dates,
})


export default function ExperienceItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => Promise.all([experienceApi.list(), bulletsApi.list()]))
  const [applyToUnsent, setApplyToUnsent] = useState(false)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const role = data?.[0].find((item) => item.experience_id === id)
  if (!data || !role) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const [roles, bullets] = data
  const labelOf = roleLabels(roles)
  const label = labelOf(role)
  const inProgress = role.used_by.filter((use) => !use.locked)

  async function refresh() {
    await Promise.all([load(), host.refresh()])
  }

  async function update(original: Experience, fields: ExperienceFields) {
    const saved = await experienceApi.update(original.experience_id, fields, applyToUnsent)
    const changedThem = inProgress.length > 0 && applyToUnsent
    let message = 'Saved.'
    if (saved.experience_id !== original.experience_id) {
      message = changedThem
        ? `Saved as a new version, "${experienceLabel(saved)}". Resumes and cover letters in progress use it now; sent ones keep "${experienceLabel(original)}".`
        : `Saved as a new version, "${experienceLabel(saved)}". Everything that used "${experienceLabel(original)}" still does; pick the new version where you want it.`
    }
    await host.saved(message, { kind: 'experience', id: saved.experience_id })
  }

  async function addVersion(original: Experience, fields: ExperienceFields) {
    const version = await experienceApi.addVersion(original.experience_id, fields)
    await host.saved(
      version.experience_id === original.experience_id
        ? 'Nothing changed, so no new version was added.'
        : `Added a new version, "${experienceLabel(version)}". Resumes and cover letters keep "${experienceLabel(original)}" until you pick the new one.`,
      { kind: 'experience', id: version.experience_id },
    )
  }

  async function confirmDelete(original: Experience) {
    setDeleteError(null)
    try {
      await experienceApi.delete(original.experience_id)
      await host.deleted(`Deleted "${experienceLabel(original)}".`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      form={
        <FieldsForm
          label={`Edit "${label}"`}
          fields={ROLE_FIELDS}
          initial={fieldsOf(role)}
          note={anyLocked(role.used_by) ? SENT_NOTE : undefined}
          onSave={(fields) => update(role, fields)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          {inProgress.length > 0 && <ApplyChoice uses={inProgress} apply={applyToUnsent} onChange={setApplyToUnsent} />}
        </FieldsForm>
      }
      newVersion={(back) => (
        <FieldsForm
          label={`New version of "${label}"`}
          fields={ROLE_FIELDS}
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
        allBullets={bullets.map((bullet) => ({ bullet_id: bullet.bullet_id, content: bullet.content }))}
        onChange={async (ids) => {
          await experienceApi.setBullets(role.experience_id, ids)
          await refresh()
        }}
        onWrite={async (content) => {
          await bulletsApi.create(content, { experience_id: role.experience_id })
          await refresh()
          host.say(`Added the bullet "${shortBullet(content)}".`)
        }}
      />
      <NameList
        title="Sections that list it"
        refs={role.sections.map((section) => ({ kind: 'section', id: section.id, title: section.title }))}
      />
      <UsedBy uses={role.used_by} />
    </ItemParts>
  )
}
