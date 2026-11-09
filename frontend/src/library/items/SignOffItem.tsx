// A sign-off's dialog: edit it (following "Changing an item" in docs/FRONTEND_CHECKS.md: a sent
// cover letter keeps the original, and letters in progress change only if the user picks them) or
// delete it.
import { useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { signOffsApi, type SignOff } from '../../shared/api/signOffs'
import { anyLocked, type Use } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import NameForm from '../../shared/components/NameForm/NameForm'
import ApplyChoice from '../ApplyChoice'
import { changeNote, inProgressUses, pickedFor, savedMessage } from '../applyChange'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'

const LOCKED_NOTE = 'A sent version uses this sign-off, so saving adds a new one. The sent version keeps this one.'

export default function SignOffItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => signOffsApi.list())
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const signOff = data?.find((item) => item.sign_off_id === id)
  if (!data || !signOff) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const { here, others, elsewhere } = inProgressUses(signOff.used_by, host.placed?.where)

  async function save(original: SignOff, text: string) {
    const saved = await signOffsApi.update(original.sign_off_id, text, pickedFor(here, applyTo))
    const message = savedMessage({
      newVersion: saved.sign_off_id !== original.sign_off_id,
      before: original.text,
      after: saved.text,
      here,
      doc: host.placed?.doc,
      checked: applyTo,
    })
    await host.saved(message, { kind: 'signOff', id: saved.sign_off_id })
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
          lockedNote={changeNote(here, others, host.placed?.doc, anyLocked(signOff.used_by) ? LOCKED_NOTE : undefined, elsewhere)}
          onSave={(text) => save(signOff, text)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          {others.length > 0 && <ApplyChoice uses={others} others={Boolean(here)} applyTo={applyTo} onChange={setApplyTo} />}
        </NameForm>
      }
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
