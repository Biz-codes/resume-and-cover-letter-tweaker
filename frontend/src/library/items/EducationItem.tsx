// An education entry's dialog: edit it (a sent version keeps the original; docs/FRONTEND_CHECKS.md,
// "Sent versions are locked"), add a version of it, or delete it. Its sections open in the same
// dialog.
import { useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { educationApi, educationLabel, type Education, type EducationFields } from '../../shared/api/education'
import { anyLocked } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import FieldsForm from '../../shared/components/FieldsForm'
import NameList from '../NameList'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'
import { EDUCATION_FIELDS, educationLabels } from './itemFields'


const SENT_NOTE = 'A sent version uses this entry, so saving adds a new one. The sent version keeps this one.'

const fieldsOf = (entry: Education): EducationFields => ({
  degree: entry.degree,
  institution: entry.institution,
  details: entry.details,
  graduation: entry.graduation,
})


export default function EducationItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => educationApi.list())
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const entry = data?.find((item) => item.education_id === id)
  if (!data || !entry) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const label = educationLabels(data)(entry)

  async function update(original: Education, fields: EducationFields) {
    const saved = await educationApi.update(original.education_id, fields)
    await host.saved(
      saved.education_id === original.education_id
        ? 'Saved.'
        : `Saved as a new entry, "${educationLabel(saved)}", listed right after the original. Sent versions keep "${educationLabel(original)}".`,
      { kind: 'education', id: saved.education_id },
    )
  }

  async function addVersion(original: Education, fields: EducationFields) {
    const version = await educationApi.addVersion(original.education_id, fields)
    await host.saved(
      version.education_id === original.education_id
        ? 'Nothing changed, so no new version was added.'
        : `Added a new version, "${educationLabel(version)}". Resumes and cover letters keep "${educationLabel(original)}" until you pick the new one.`,
      { kind: 'education', id: version.education_id },
    )
  }

  async function confirmDelete(original: Education) {
    setDeleteError(null)
    try {
      await educationApi.delete(original.education_id)
      await host.deleted(`Deleted "${educationLabel(original)}".`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      hidden={entry.hidden}
      usedBySent={anyLocked(entry.used_by)}
      onSetHidden={async (next) => {
        await educationApi.setHidden(entry.education_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <FieldsForm
          label={`Edit "${label}"`}
          fields={EDUCATION_FIELDS}
          initial={fieldsOf(entry)}
          note={anyLocked(entry.used_by) ? SENT_NOTE : undefined}
          onSave={(fields) => update(entry, fields)}
          focusOnOpen={false}
          onCancel={host.close}
        />
      }
      newVersion={(back) => (
        <FieldsForm
          label={`New version of "${label}"`}
          fields={EDUCATION_FIELDS}
          initial={fieldsOf(entry)}
          submitLabel="Add version"
          onSave={(fields) => addVersion(entry, fields)}
          onCancel={back}
        />
      )}
      confirmDelete={(back) => (
        <ConfirmDelete
          what={`"${label}"`}
          uses={entry.used_by}
          effect="It's removed from them, and from every section."
          error={deleteError}
          onConfirm={() => void confirmDelete(entry)}
          onCancel={back}
        />
      )}
    >
      <NameList
        title="Sections that list it"
        refs={entry.sections.map((section) => ({ kind: 'section', id: section.id, title: section.title }))}
      />
      <UsedBy uses={entry.used_by} />
    </ItemParts>
  )
}
