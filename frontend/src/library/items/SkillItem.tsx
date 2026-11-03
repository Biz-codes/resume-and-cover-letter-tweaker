// A skill's dialog: rename it (a sent version keeps the old name), add a version of it, or delete
// it. The categories and projects that list it open in the same dialog.
import { useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { projectLabel } from '../../shared/api/projects'
import { skillsApi, type Skill } from '../../shared/api/skills'
import { anyLocked } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import NameForm from '../../shared/components/NameForm/NameForm'
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
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const skill = data?.find((item) => item.skill_id === id)
  if (!data || !skill) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />

  async function rename(original: Skill, name: string) {
    const saved = await skillsApi.rename(original.skill_id, name)
    await host.saved(
      saved.skill_id === original.skill_id
        ? 'Saved.'
        : `Saved as a new skill, "${saved.skill_name}". Sent versions keep "${original.skill_name}".`,
      { kind: 'skill', id: saved.skill_id },
    )
  }

  async function addVersion(original: Skill, name: string) {
    const version = await skillsApi.addVersion(original.skill_id, name)
    await host.saved(
      `Added "${version.skill_name}", listed right after "${original.skill_name}". Resumes and cover letters keep "${original.skill_name}" until you pick the new one.`,
      { kind: 'skill', id: version.skill_id },
    )
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
          lockedNote={anyLocked(skill.used_by) ? lockedNote('skill') : undefined}
          onSave={(name) => rename(skill, name)}
          focusOnOpen={false}
          onCancel={host.close}
        />
      }
      newVersion={(back) => (
        <NameForm
          label="New version's name"
          field="skill_name"
          initial={skill.skill_name}
          submitLabel="Add version"
          onSave={(name) => addVersion(skill, name)}
          onCancel={back}
        />
      )}
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
