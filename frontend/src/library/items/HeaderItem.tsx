// A header's dialog: edit it (following "Changing an item" in docs/FRONTEND_CHECKS.md: a sent
// version keeps the original, and postings and base resumes and cover letters in progress change
// only if the user picks them; identical headers are reused, "Headers") or delete it.
import { useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { headersApi, type Header, type HeaderFields } from '../../shared/api/headers'
import { anyLocked, type Use } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import ApplyChoice from '../ApplyChoice'
import { changeNote, savedMessage } from '../applyChange'
import UsedBy from '../UsedBy'
import HeaderForm from './HeaderForm'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'
import { headerLabels } from './itemFields'


const SENT_NOTE = 'A sent version uses this header, so saving adds a new header. The sent version keeps this one.'

const fieldsOf = (header: Header): HeaderFields => {
  const { header_id: _id, hidden: _hidden, created_at: _added, used_by: _usedBy, in_progress: _inProgress, ...fields } = header
  return fields
}

export default function HeaderItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => headersApi.list())
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const header = data?.find((item) => item.header_id === id)
  if (!data || !header) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const label = headerLabels(data)(header)
  // A posting's resumes and cover letters share its header, so the posting is what's checked.
  const offeredUses = header.in_progress

  async function update(original: Header, fields: HeaderFields) {
    const saved = await headersApi.update(original.header_id, fields, applyTo)
    const message = savedMessage({
      newVersion: saved.header_id !== original.header_id,
      before: headerLabels(data ?? [])(original),
      after: headerLabels([...(data ?? []), saved])(saved),
      here: undefined,
      doc: undefined,
      checked: applyTo,
    })
    await host.saved(message, { kind: 'header', id: saved.header_id })
  }


  async function confirmDelete() {
    setDeleteError(null)
    try {
      await headersApi.delete(id)
      await host.deleted('Header deleted.')
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      name={`"${label}"`}
      hidden={header.hidden}
      usedBySent={anyLocked(header.used_by)}
      onSetHidden={async (next) => {
        await headersApi.setHidden(header.header_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <HeaderForm
          label="Edit header"
          initial={fieldsOf(header)}
          note={changeNote(undefined, offeredUses, undefined, anyLocked(header.used_by) ? SENT_NOTE : undefined)}
          onSave={(fields) => update(header, fields)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          {offeredUses.length > 0 && <ApplyChoice uses={offeredUses} applyTo={applyTo} onChange={setApplyTo} />}
        </HeaderForm>
      }
      confirmDelete={(back) => (
        <ConfirmDelete
          what={`"${label}"`}
          uses={header.used_by}
          effect="They keep going with no header until you pick another."
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={back}
        />
      )}
    >
      <UsedBy uses={header.used_by} />
    </ItemParts>
  )
}
