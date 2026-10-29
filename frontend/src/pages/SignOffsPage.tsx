// Library page for sign-offs: the closing before the name in a cover letter ("Sincerely").
// Add, edit, and delete them. Editing one a sent cover letter uses saves a new sign-off
// (docs/FRONTEND_CHECKS.md, "Sent versions are locked").
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../api/client'
import { signOffsApi, type SignOff } from '../api/signOffs'
import { anyLocked } from '../api/usage'
import ConfirmDelete from '../components/ConfirmDelete'
import NameForm from '../components/NameForm'
import UsedBy from '../components/UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

const LOCKED_NOTE =
  'A sent cover letter uses this sign-off, so your change will be saved as a new sign-off. Sent letters keep this one; unsent ones switch to the new one.'

const buttonId = (id: number, action: 'edit' | 'delete') => `sign-off-${id}-${action}`

export default function SignOffsPage() {
  const [signOffs, setSignOffs] = useState<SignOff[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
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
    setNotice(
      saved.sign_off_id === signOff.sign_off_id
        ? 'Saved.'
        : `Saved as a new sign-off, "${saved.text}". Sent cover letters keep "${signOff.text}".`,
    )
    await load()
    focusLater(buttonId(saved.sign_off_id, 'edit'))
  }

  async function confirmDelete(signOff: SignOff) {
    setDeleteError(null)
    try {
      await signOffsApi.delete(signOff.sign_off_id)
      setDeleting(null)
      focusLater(PAGE_HEADING_ID)
      setNotice(`Deleted "${signOff.text}".`)
      await load()
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  function card(signOff: SignOff) {
    const id = signOff.sign_off_id
    const label = `"${signOff.text}"`
    return (
      <article key={id} className="card">
        {editing === id ? (
          <NameForm
            label="Sign-off"
            field="text"
            initial={signOff.text}
            lockedNote={anyLocked(signOff.used_by) ? LOCKED_NOTE : undefined}
            onSave={(text) => save(signOff, text)}
            onCancel={() => {
              setEditing(null)
              focusLater(buttonId(id, 'edit'))
            }}
          />
        ) : (
          <div className="card-header">
            <h3>{signOff.text}</h3>
            {deleting !== id && (
              <div className="actions">
                <button
                  type="button"
                  id={buttonId(id, 'edit')}
                  aria-label={`Edit ${label}`}
                  onClick={() => {
                    setEditing(id)
                    setDeleting(null)
                    setNotice(null)
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  id={buttonId(id, 'delete')}
                  aria-label={`Delete ${label}`}
                  onClick={() => {
                    setDeleting(id)
                    setDeleteError(null)
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
        {deleting === id && (
          <ConfirmDelete
            what={label}
            uses={signOff.used_by}
            effect="They keep going with no closing until you pick another."
            error={deleteError}
            onConfirm={() => void confirmDelete(signOff)}
            onCancel={() => {
              setDeleting(null)
              focusLater(buttonId(id, 'delete'))
            }}
          />
        )}
        <UsedBy uses={signOff.used_by} />
      </article>
    )
  }

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
    </section>
  )
}
