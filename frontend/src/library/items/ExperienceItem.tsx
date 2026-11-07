// A role's dialog: edit it (following "Changing an item" in docs/FRONTEND_CHECKS.md: sent
// versions never change, and resumes and cover letters in progress change only if the user picks
// them), delete it, and edit its ordered bullet list. Its bullets and sections open in the same
// dialog.
import { useState } from 'react'
import { bulletsApi, shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { experienceApi, experienceLabel, type Experience, type ExperienceFields } from '../../shared/api/experience'
import { anyLocked, type Use } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import FieldsForm from '../../shared/components/FieldsForm'
import ApplyChoice from '../ApplyChoice'
import { changeNote, inProgressUses, pickedFor, savedMessage } from '../applyChange'
import BulletList from '../BulletList'
import NameList from '../NameList'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'
import { ROLE_FIELDS, roleLabels } from './itemFields'
import { offered } from '../../shared/offered'


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
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const role = data?.[0].find((item) => item.experience_id === id)
  if (!data || !role) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const [roles, bullets] = data
  const labelOf = roleLabels(roles)
  const label = labelOf(role)
  const { here, others } = inProgressUses(role.used_by, host.placed?.where)

  async function refresh() {
    await Promise.all([load(), host.refresh()])
  }

  async function update(original: Experience, fields: ExperienceFields) {
    const saved = await experienceApi.update(original.experience_id, fields, pickedFor(here, applyTo))
    const message = savedMessage({
      newVersion: saved.experience_id !== original.experience_id,
      before: experienceLabel(original),
      after: experienceLabel(saved),
      here,
      doc: host.placed?.doc,
      checked: applyTo,
    })
    await host.saved(message, { kind: 'experience', id: saved.experience_id })
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
      name={`"${label}"`}
      hidden={role.hidden}
      usedBySent={anyLocked(role.used_by)}
      onSetHidden={async (next) => {
        await experienceApi.setHidden(role.experience_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <FieldsForm
          label={`Edit "${label}"`}
          fields={ROLE_FIELDS}
          initial={fieldsOf(role)}
          note={changeNote(here, others, host.placed?.doc, anyLocked(role.used_by) ? SENT_NOTE : undefined)}
          onSave={(fields) => update(role, fields)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          {others.length > 0 && <ApplyChoice uses={others} others={Boolean(here)} applyTo={applyTo} onChange={setApplyTo} />}
        </FieldsForm>
      }
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
        allBullets={offered(bullets).map((bullet) => ({ bullet_id: bullet.bullet_id, content: bullet.content }))}
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
