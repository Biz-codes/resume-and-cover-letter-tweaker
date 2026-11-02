// Library page for sign-offs: the closing before the name in a cover letter ("Sincerely").
// Add them, and open each one's dialog (ItemDialog) to edit it, add a version of it, or delete it.
// Editing one a sent cover letter uses saves a new sign-off
// (docs/FRONTEND_CHECKS.md, "Sent versions are locked").
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { signOffsApi, type SignOff } from '../shared/api/signOffs'
import { anyLocked } from '../shared/api/usage'
import ConfirmDelete from '../shared/components/ConfirmDelete'
import NameForm from '../shared/components/NameForm/NameForm'
import ItemDialog from './ItemDialog'
import LibraryCard from './LibraryCard'
import UsedBy from './UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'

const LOCKED_NOTE = 'A sent version uses this sign-off, so saving adds a new one. The sent version keeps this one.'

// The Edit button's id, where focus returns when the dialog closes after a save.
const editId = (id: number) => `sign-off-${id}-edit`

export default function SignOffsPage() {
  const [signOffs, setSignOffs] = useState<SignOff[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  // The sign-off whose dialog is open.
  const [editing, setEditing] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Sign-offs')

  const load = useCallback(
    () =>
      signOffsApi
        .list()
        .then((list) => {
          setSignOffs(list)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function create(text: string) {
    await signOffsApi.create(text)
    setNotice(`Added "${text.trim()}".`)
    await load()
  }

  async function save(signOff: SignOff, text: string) {
    const saved = await signOffsApi.update(signOff.sign_off_id, text)
    setEditing(null)
    await load()
    setNotice(
      saved.sign_off_id === signOff.sign_off_id
        ? 'Saved.'
        : `Saved as a new sign-off, "${saved.text}". Sent cover letters keep "${signOff.text}".`,
    )
    focusLater(editId(saved.sign_off_id))
  }

  async function addVersion(signOff: SignOff, text: string) {
    const version = await signOffsApi.addVersion(signOff.sign_off_id, text)
    setEditing(null)
    await load()
    setNotice(
      version.sign_off_id === signOff.sign_off_id
        ? 'Nothing changed, so no new version was added.'
        : `Added "${version.text}". Cover letters keep "${signOff.text}" until you pick the new one.`,
    )
    focusLater(editId(version.sign_off_id))
  }

  async function confirmDelete(signOff: SignOff) {
    setDeleteError(null)
    try {
      await signOffsApi.delete(signOff.sign_off_id)
      setEditing(null)
      focusLater(PAGE_HEADING_ID)
      await load()
      setNotice(`Deleted "${signOff.text}".`)
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  function card(signOff: SignOff) {
    return (
      <LibraryCard
        key={signOff.sign_off_id}
        title={signOff.text}
        heading={3}
        editId={editId(signOff.sign_off_id)}
        editLabel={`Edit "${signOff.text}"`}
        onEdit={() => {
          setEditing(signOff.sign_off_id)
          setDeleteError(null)
          setNotice(null)
        }}
      />
    )
  }

  function itemDialog(signOff: SignOff) {
    return (
      <ItemDialog
        title={signOff.text}
        onClose={() => setEditing(null)}
        form={
          <NameForm
            label="Sign-off"
            field="text"
            initial={signOff.text}
            lockedNote={anyLocked(signOff.used_by) ? LOCKED_NOTE : undefined}
            onSave={(text) => save(signOff, text)}
            onCancel={() => setEditing(null)}
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
      </ItemDialog>
    )
  }

  const editingSignOff = signOffs?.find((signOff) => signOff.sign_off_id === editing)

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Sign-offs
      </h2>
      <p className="muted">
        The closing at the end of a cover letter, printed with a comma and your name on the next line. New cover letters
        start with "Sincerely".
      </p>
      <p role="status">{notice}</p>
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!signOffs && !loadError && <p>Loading…</p>}

      {signOffs && <NameForm label="New sign-off" field="text" submitLabel="Add sign-off" onSave={create} />}
      {signOffs && signOffs.length === 0 && <p>No sign-offs yet.</p>}
      {signOffs?.map(card)}
      {editingSignOff && itemDialog(editingSignOff)}
    </section>
  )
}
