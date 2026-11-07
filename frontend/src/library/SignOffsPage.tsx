// Library page for sign-offs: the closing before the name in a cover letter ("Sincerely"). Add
// them, and open each one's dialog (SignOffItem) to edit or delete it.
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { signOffsApi, type SignOff } from '../shared/api/signOffs'
import NameForm from '../shared/components/NameForm/NameForm'
import { PAGE_HEADING_ID } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import HiddenItems, { UnhideButton } from './HiddenItems'
import LibraryCard from './LibraryCard'
import { SORT_NOTE, sortByName } from '../shared/sortByName'
import { useUnhide } from './useUnhide'
import AlertDialog from '../shared/components/Dialog/AlertDialog'

export default function SignOffsPage() {
  const [signOffs, setSignOffs] = useState<SignOff[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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

  const dialogs = useItemDialogs({ reload: load, notify: setNotice })
  const unhide = useUnhide(load, setNotice)

  async function create(text: string) {
    await signOffsApi.create(text)
    await load()
    setNotice(`Added "${text.trim()}".`)
  }

  // `hidden`: a card in the Hidden group, with Unhide.
  function card(signOff: SignOff, hidden = false) {
    return (
      <LibraryCard
        key={signOff.sign_off_id}
        title={signOff.text}
        heading={hidden ? 4 : 3}
        editId={editId('signOff', signOff.sign_off_id)}
        editLabel={`View and Edit "${signOff.text}"`}
        actions={
          hidden && (
            <UnhideButton
              name={signOff.text}
              onUnhide={() =>
                unhide('signOff', signOff.sign_off_id, signOff.text, () => signOffsApi.setHidden(signOff.sign_off_id, false))
              }
            />
          )
        }
        onEdit={() => dialogs.open({ kind: 'signOff', id: signOff.sign_off_id, title: signOff.text })}
      />
    )
  }

  const all = sortByName(signOffs ?? [], (signOff) => signOff.text)
  const shown = all.filter((signOff) => !signOff.hidden)
  const hiddenOnes = all.filter((signOff) => signOff.hidden)

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Sign-offs
      </h2>
      <p className="muted">
        The closing at the end of a cover letter, printed with a comma and your name on the next line. New cover letters
        start with "Sincerely".
      </p>
      <p className="muted">{SORT_NOTE}</p>
      <AlertDialog message={notice} onClose={() => setNotice(null)} />
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
      {shown.map((signOff) => card(signOff))}
      <HiddenItems count={hiddenOnes.length}>{hiddenOnes.map((signOff) => card(signOff, true))}</HiddenItems>
      {dialogs.dialog}
    </section>
  )
}
