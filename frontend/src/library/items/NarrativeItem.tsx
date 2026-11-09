// An excerpt of narrative content's dialog: edit its text and the sections that list it
// (following "Changing an item" in docs/FRONTEND_CHECKS.md: sent versions never change, and
// resumes and cover letters in progress change only if the user picks them), or delete it.
import { useState } from 'react'
import { shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { narrativeApi, type NarrativeContent } from '../../shared/api/narrativeContent'
import { sectionsApi } from '../../shared/api/sections'
import { anyLocked, type Use } from '../../shared/api/usage'
import Checklist from '../../shared/components/Checklist'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import FieldsForm from '../../shared/components/FieldsForm'
import ApplyChoice from '../ApplyChoice'
import { changeNote, inProgressUses, pickedFor, savedMessage } from '../applyChange'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'
import { EXCERPT_FIELDS, type ExcerptFields } from './itemFields'
import { offered } from '../../shared/offered'


const LOCKED_NOTE = 'A sent version uses this excerpt, so saving adds a new one. The sent version keeps this one.'

export default function NarrativeItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => Promise.all([narrativeApi.list(), sectionsApi.list()]))
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  // The sections checked in the form, starting with the ones that list it.
  const [chosen, setChosen] = useState<number[] | null>(null)

  const excerpt = data?.[0].find((item) => item.content_id === id)
  if (!data || !excerpt) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const sections = data[1]
  const checked = chosen ?? excerpt.sections.map((section) => section.id)
  const label = `"${shortBullet(excerpt.content)}"`
  const { here, others, elsewhere } = inProgressUses(excerpt.used_by, host.placed?.where)

  async function update(original: NarrativeContent, { content }: ExcerptFields) {
    const saved = await narrativeApi.update(original.content_id, content, checked, pickedFor(here, applyTo))
    const message = savedMessage({
      newVersion: saved.content_id !== original.content_id,
      before: shortBullet(original.content),
      after: shortBullet(saved.content),
      here,
      doc: host.placed?.doc,
      checked: applyTo,
    })
    await host.saved(message, { kind: 'narrative', id: saved.content_id })
  }


  async function confirmDelete(original: NarrativeContent) {
    setDeleteError(null)
    try {
      await narrativeApi.delete(original.content_id)
      await host.deleted(`Deleted "${shortBullet(original.content)}".`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      name={label}
      hidden={excerpt.hidden}
      usedBySent={anyLocked(excerpt.used_by)}
      onSetHidden={async (next) => {
        await narrativeApi.setHidden(excerpt.content_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <FieldsForm
          label={`Edit ${label}`}
          fields={EXCERPT_FIELDS}
          initial={{ content: excerpt.content }}
          note={changeNote(here, others, host.placed?.doc, anyLocked(excerpt.used_by) ? LOCKED_NOTE : undefined, elsewhere)}
          onSave={(fields) => update(excerpt, fields)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          <Checklist
            legend="Sections that list it"
            options={offered(sections, (section) => excerpt.sections.some((listed) => listed.id === section.id)).map(
              (section) => ({ id: section.id, name: section.title }),
            )}
            selected={checked}
            onChange={setChosen}
          />
          {others.length > 0 && <ApplyChoice uses={others} others={Boolean(here)} applyTo={applyTo} onChange={setApplyTo} />}
        </FieldsForm>
      }
      confirmDelete={(back) => (
        <ConfirmDelete
          what={label}
          uses={excerpt.used_by}
          effect="It's removed from them, and from every section."
          error={deleteError}
          onConfirm={() => void confirmDelete(excerpt)}
          onCancel={back}
        />
      )}
    >
      <UsedBy uses={excerpt.used_by} />
    </ItemParts>
  )
}
