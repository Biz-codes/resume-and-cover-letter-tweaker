// A bullet's dialog: edit it (following "Changing an item" in docs/FRONTEND_CHECKS.md: sent
// versions never change, and resumes and cover letters in progress change only if the user picks
// them) or delete it. The roles, projects, and sections that list it open in the same dialog.
import { useState } from 'react'
import { bulletsApi, shortBullet, type Bullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { experienceLabel } from '../../shared/api/experience'
import { projectLabel } from '../../shared/api/projects'
import { anyLocked, type Use } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import NameForm from '../../shared/components/NameForm/NameForm'
import ApplyChoice from '../ApplyChoice'
import { changeNote, inProgressUses, pickedFor, savedMessage } from '../applyChange'
import NameList from '../NameList'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'

const LOCKED_NOTE = 'A sent version uses this bullet, so saving adds a new one. The sent version keeps this one.'

export default function BulletItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => bulletsApi.list())
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const bullet = data?.find((item) => item.bullet_id === id)
  if (!data || !bullet) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const label = `"${shortBullet(bullet.content)}"`
  const { here, others, elsewhere } = inProgressUses(bullet.used_by, host.placed?.where)

  async function save(original: Bullet, content: string) {
    const saved = await bulletsApi.update(original.bullet_id, content, pickedFor(here, applyTo))
    const message = savedMessage({
      newVersion: saved.bullet_id !== original.bullet_id,
      before: shortBullet(original.content),
      after: shortBullet(saved.content),
      here,
      doc: host.placed?.doc,
      checked: applyTo,
    })
    await host.saved(message, { kind: 'bullet', id: saved.bullet_id })
  }


  async function confirmDelete(original: Bullet) {
    setDeleteError(null)
    try {
      await bulletsApi.delete(original.bullet_id)
      await host.deleted(`Deleted "${shortBullet(original.content)}".`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      name={label}
      hidden={bullet.hidden}
      usedBySent={anyLocked(bullet.used_by)}
      onSetHidden={async (next) => {
        await bulletsApi.setHidden(bullet.bullet_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <NameForm
          label="Bullet text"
          field="content"
          initial={bullet.content}
          multiline
          lockedNote={changeNote(here, others, host.placed?.doc, anyLocked(bullet.used_by) ? LOCKED_NOTE : undefined, elsewhere)}
          onSave={(content) => save(bullet, content)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          {others.length > 0 && <ApplyChoice uses={others} others={Boolean(here)} applyTo={applyTo} onChange={setApplyTo} />}
        </NameForm>
      }
      confirmDelete={(back) => (
        <ConfirmDelete
          what={label}
          uses={bullet.used_by}
          effect="It's removed from them, and from every role, project, and section."
          error={deleteError}
          onConfirm={() => void confirmDelete(bullet)}
          onCancel={back}
        />
      )}
    >
      <NameList
        title="Roles"
        refs={bullet.experience.map((role) => ({ kind: 'experience', id: role.experience_id, title: experienceLabel(role) }))}
      />
      <NameList
        title="Projects"
        refs={bullet.projects.map((project) => ({ kind: 'project', id: project.project_id, title: projectLabel(project) }))}
      />
      <NameList
        title="Sections"
        refs={bullet.sections.map((section) => ({ kind: 'section', id: section.id, title: section.title }))}
      />
      <UsedBy uses={bullet.used_by} />
    </ItemParts>
  )
}
