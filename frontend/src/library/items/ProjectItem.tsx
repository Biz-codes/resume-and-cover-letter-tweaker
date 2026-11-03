// A project's dialog: edit it (following "Changing a role or project" in docs/FRONTEND_CHECKS.md),
// add a version of it, delete it, and edit its ordered skill and bullet lists. Its skills,
// bullets, and sections open in the same dialog.
import { useState } from 'react'
import { bulletsApi, shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { projectLabel, projectsApi, type Project, type ProjectFields } from '../../shared/api/projects'
import { skillsApi } from '../../shared/api/skills'
import { anyLocked } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import FieldsForm from '../../shared/components/FieldsForm'
import OrderedList from '../../shared/components/OrderedList/OrderedList'
import ApplyChoice from '../ApplyChoice'
import BulletList from '../BulletList'
import Collapsible from '../Collapsible/Collapsible'
import NameList from '../NameList'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'
import { PROJECT_FIELDS, projectLabels } from './itemFields'
import { offered } from '../../shared/offered'


const SENT_NOTE = 'A sent version uses this project, so saving adds a new version. The sent version keeps this one.'

const fieldsOf = (project: Project): ProjectFields => ({
  project_title: project.project_title,
  done_for: project.done_for,
  url: project.url,
  dates: project.dates,
})


export default function ProjectItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => Promise.all([projectsApi.list(), skillsApi.list(), bulletsApi.list()]))
  const [applyToUnsent, setApplyToUnsent] = useState(false)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const project = data?.[0].find((item) => item.project_id === id)
  if (!data || !project) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const [projects, skills, bullets] = data
  const label = projectLabels(projects)(project)
  const inProgress = project.used_by.filter((use) => !use.locked)

  async function refresh() {
    await Promise.all([load(), host.refresh()])
  }

  async function update(original: Project, fields: ProjectFields) {
    const saved = await projectsApi.update(original.project_id, fields, applyToUnsent)
    const changedThem = inProgress.length > 0 && applyToUnsent
    let message = 'Saved.'
    if (saved.project_id !== original.project_id) {
      message = changedThem
        ? `Saved as a new version, "${projectLabel(saved)}". Resumes and cover letters in progress use it now; sent ones keep "${projectLabel(original)}".`
        : `Saved as a new version, "${projectLabel(saved)}". Everything that used "${projectLabel(original)}" still does; pick the new version where you want it.`
    }
    await host.saved(message, { kind: 'project', id: saved.project_id })
  }

  async function addVersion(original: Project, fields: ProjectFields) {
    const version = await projectsApi.addVersion(original.project_id, fields)
    await host.saved(
      version.project_id === original.project_id
        ? 'Nothing changed, so no new version was added.'
        : `Added a new version, "${projectLabel(version)}". Resumes and cover letters keep "${projectLabel(original)}" until you pick the new one.`,
      { kind: 'project', id: version.project_id },
    )
  }

  async function confirmDelete(original: Project) {
    setDeleteError(null)
    try {
      await projectsApi.delete(original.project_id)
      await host.deleted(`Deleted "${projectLabel(original)}".`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      hidden={project.hidden}
      usedBySent={anyLocked(project.used_by)}
      onSetHidden={async (next) => {
        await projectsApi.setHidden(project.project_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <FieldsForm
          label={`Edit "${label}"`}
          fields={PROJECT_FIELDS}
          initial={fieldsOf(project)}
          note={anyLocked(project.used_by) ? SENT_NOTE : undefined}
          onSave={(fields) => update(project, fields)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          {inProgress.length > 0 && <ApplyChoice uses={inProgress} apply={applyToUnsent} onChange={setApplyToUnsent} />}
        </FieldsForm>
      }
      newVersion={(back) => (
        <FieldsForm
          label={`New version of "${label}"`}
          fields={PROJECT_FIELDS}
          initial={fieldsOf(project)}
          submitLabel="Add version"
          onSave={(fields) => addVersion(project, fields)}
          onCancel={back}
        />
      )}
      confirmDelete={(back) => (
        <ConfirmDelete
          what={`"${label}"`}
          uses={project.used_by}
          effect="It's removed from them, along with its skills and bullets there. The skills and bullets stay in the library."
          error={deleteError}
          onConfirm={() => void confirmDelete(project)}
          onCancel={back}
        />
      )}
    >
      <Collapsible title="Skills" count={project.skills.length}>
        <OrderedList
          label={`${label} skills`}
          items={project.skills.map((skill) => ({ id: skill.skill_id, name: skill.skill_name }))}
          choices={offered(skills).map((skill) => ({ id: skill.skill_id, name: skill.skill_name }))}
          emptyText="No skills yet."
          onOpen={(item) => host.open({ kind: 'skill', id: item.id, title: item.name })}
          onChange={async (ids) => {
            await projectsApi.setSkills(project.project_id, ids)
            await refresh()
          }}
        />
      </Collapsible>
      <BulletList
        owner={label}
        bullets={project.bullets}
        allBullets={offered(bullets).map((bullet) => ({ bullet_id: bullet.bullet_id, content: bullet.content }))}
        onChange={async (ids) => {
          await projectsApi.setBullets(project.project_id, ids)
          await refresh()
        }}
        onWrite={async (content) => {
          await bulletsApi.create(content, { project_id: project.project_id })
          await refresh()
          host.say(`Added the bullet "${shortBullet(content)}".`)
        }}
      />
      <NameList
        title="Sections that list it"
        refs={project.sections.map((section) => ({ kind: 'section', id: section.id, title: section.title }))}
      />
      <UsedBy uses={project.used_by} />
    </ItemParts>
  )
}
