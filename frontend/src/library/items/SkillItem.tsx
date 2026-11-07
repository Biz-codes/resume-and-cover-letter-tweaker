// A skill's dialog: rename it (following "Changing an item" in docs/FRONTEND_CHECKS.md: sent
// versions keep the old name, and resumes and cover letters in progress change only if the user
// picks them) or delete it. The categories and projects that list it open in the same dialog.
import { useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { projectLabel } from '../../shared/api/projects'
import { skillsApi, type Skill } from '../../shared/api/skills'
import { anyLocked, type Use } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import NameForm from '../../shared/components/NameForm/NameForm'
import ApplyChoice from '../ApplyChoice'
import { changeNote, inProgressUses, pickedFor, savedMessage } from '../applyChange'
import NameList from '../NameList'
import UsedBy from '../UsedBy'
import { lockedNote } from './itemFields'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'

export default function SkillItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => skillsApi.list())
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const skill = data?.find((item) => item.skill_id === id)
  if (!data || !skill) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const { here, others } = inProgressUses(skill.used_by, host.placed?.where)

  async function rename(original: Skill, name: string) {
    const saved = await skillsApi.rename(original.skill_id, name, pickedFor(here, applyTo))
    const message = savedMessage({
      newVersion: saved.skill_id !== original.skill_id,
      before: original.skill_name,
      after: saved.skill_name,
      here,
      doc: host.placed?.doc,
      checked: applyTo,
    })
    await host.saved(message, { kind: 'skill', id: saved.skill_id })
  }


  async function confirmDelete(original: Skill) {
    setDeleteError(null)
    try {
      await skillsApi.delete(original.skill_id)
      await host.deleted(`Deleted "${original.skill_name}".`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      name={`"${skill.skill_name}"`}
      hidden={skill.hidden}
      usedBySent={anyLocked(skill.used_by)}
      onSetHidden={async (next) => {
        await skillsApi.setHidden(skill.skill_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <NameForm
          label="Skill name"
          field="skill_name"
          initial={skill.skill_name}
          lockedNote={changeNote(here, others, host.placed?.doc, anyLocked(skill.used_by) ? lockedNote('skill') : undefined)}
          onSave={(name) => rename(skill, name)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          {others.length > 0 && <ApplyChoice uses={others} others={Boolean(here)} applyTo={applyTo} onChange={setApplyTo} />}
        </NameForm>
      }
      confirmDelete={(back) => (
        <ConfirmDelete
          what={`"${skill.skill_name}"`}
          uses={skill.used_by}
          effect="It's removed from them, and from every category and project."
          error={deleteError}
          onConfirm={() => void confirmDelete(skill)}
          onCancel={back}
        />
      )}
    >
      <NameList
        title="Categories"
        refs={skill.categories.map((category) => ({ kind: 'category', id: category.category_id, title: category.category_name }))}
      />
      <NameList
        title="Projects"
        refs={skill.projects.map((project) => ({ kind: 'project', id: project.project_id, title: projectLabel(project) }))}
      />
      <UsedBy uses={skill.used_by} />
    </ItemParts>
  )
}
