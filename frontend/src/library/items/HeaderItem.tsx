// A header's dialog: edit it (a sent version keeps the original, and identical headers are reused;
// docs/FRONTEND_CHECKS.md, "Headers"), add a version of it, or delete it.
import { useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { headersApi, type Header, type HeaderFields } from '../../shared/api/headers'
import { anyLocked } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import UsedBy from '../UsedBy'
import HeaderForm from './HeaderForm'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'
import { headerLabels } from './itemFields'


const fieldsOf = (header: Header): HeaderFields => {
  const { header_id: _id, created_at: _added, used_by: _usedBy, ...fields } = header
  return fields
}

export default function HeaderItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => headersApi.list())
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const header = data?.find((item) => item.header_id === id)
  if (!data || !header) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const label = headerLabels(data)(header)
  const known = new Set(data.map((item) => item.header_id))

  async function update(original: Header, fields: HeaderFields) {
    const saved = await headersApi.update(original.header_id, fields)
    await host.saved(
      saved.header_id === original.header_id
        ? 'Saved.'
        : 'Saved as a new header. Everything that used the original still uses it.',
      { kind: 'header', id: saved.header_id },
    )
  }

  async function addVersion(original: Header, fields: HeaderFields) {
    const version = await headersApi.addVersion(original.header_id, fields)
    await host.saved(
      known.has(version.header_id)
        ? 'A header with those values already exists, so no new one was added.'
        : 'Added a new header. Everything keeps the header it uses until you pick the new one.',
      { kind: 'header', id: version.header_id },
    )
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
          locked={anyLocked(header.used_by)}
          onSave={(fields) => update(header, fields)}
          focusOnOpen={false}
          onCancel={host.close}
        />
      }
      newVersion={(back) => (
        <HeaderForm
          label="New version of the header"
          initial={fieldsOf(header)}
          submitLabel="Add version"
          onSave={(fields) => addVersion(header, fields)}
          onCancel={back}
        />
      )}
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
