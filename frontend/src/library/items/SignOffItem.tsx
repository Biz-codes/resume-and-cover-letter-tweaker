// A sign-off's dialog: edit it (a sent cover letter keeps the original; docs/FRONTEND_CHECKS.md,
// "Sent versions are locked"), add a version of it, or delete it.
import { useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { signOffsApi, type SignOff } from '../../shared/api/signOffs'
import { anyLocked } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import NameForm from '../../shared/components/NameForm/NameForm'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'

const LOCKED_NOTE = 'A sent version uses this sign-off, so saving adds a new one. The sent version keeps this one.'

export default function SignOffItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => signOffsApi.list())
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const signOff = data?.find((item) => item.sign_off_id === id)
  if (!data || !signOff) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />

  async function save(original: SignOff, text: string) {
    const saved = await signOffsApi.update(original.sign_off_id, text)
    await host.saved(
      saved.sign_off_id === original.sign_off_id
        ? 'Saved.'
        : `Saved as a new sign-off, "${saved.text}". Sent cover letters keep "${original.text}".`,
      { kind: 'signOff', id: saved.sign_off_id },
    )
  }

  async function addVersion(original: SignOff, text: string) {
    const version = await signOffsApi.addVersion(original.sign_off_id, text)
    await host.saved(
      version.sign_off_id === original.sign_off_id
        ? 'Nothing changed, so no new version was added.'
        : `Added "${version.text}". Cover letters keep "${original.text}" until you pick the new one.`,
      { kind: 'signOff', id: version.sign_off_id },
    )
  }

  async function confirmDelete(original: SignOff) {
    setDeleteError(null)
    try {
      await signOffsApi.delete(original.sign_off_id)
      await host.deleted(`Deleted "${original.text}".`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      name={`"${signOff.text}"`}
      hidden={signOff.hidden}
      usedBySent={anyLocked(signOff.used_by)}
      onSetHidden={async (next) => {
        await signOffsApi.setHidden(signOff.sign_off_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <NameForm
          label="Sign-off"
          field="text"
          initial={signOff.text}
          lockedNote={anyLocked(signOff.used_by) ? LOCKED_NOTE : undefined}
          onSave={(text) => save(signOff, text)}
          focusOnOpen={false}
          onCancel={host.close}
        />
      }
      newVersion={(back) => (
        <NameForm
          label="New version's sign-off"
          field="text"
          initial={signOff.text}
          submitLabel="Add version"
          onSave={(text) => addVersion(signOff, text)}
          onCancel={back}
        />
      )}
      confirmDelete={(back) => (
        <ConfirmDelete
          what={`"${signOff.text}"`}
          uses={signOff.used_by}
          effect="They keep going with no closing until you pick another."
          error={deleteError}
          onConfirm={() => void confirmDelete(signOff)}
          onCancel={back}
        />
      )}
    >
      <UsedBy uses={signOff.used_by} />
    </ItemParts>
  )
}
