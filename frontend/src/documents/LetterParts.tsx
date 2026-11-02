// A cover letter's greeting and sign-off, each a level of the letter's tree. Each change saves right
// away: a choice when it's made, typed text when the user leaves the field or presses Enter. A new
// sign-off is written in its own form, opened from "New sign-off". The name under the sign-off
// starts as the header's name, and is saved only when it differs (empty means the header's).
// Read-only, they show what the letter prints. See "Default greeting" and "Default sign-off" in
// docs/FRONTEND_CHECKS.md.
import { useId, useState, type KeyboardEvent } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import type { DocDetail, DocFields } from '../shared/api/documents'
import type { SignOff } from '../shared/api/signOffs'
import { useFocusLater } from '../shared/hooks/useFocusLater'
import NameForm from '../shared/components/NameForm/NameForm'

type LetterFields = Partial<Pick<DocFields, 'addressee' | 'sign_off_id' | 'signature_name'>>

// Saves one change, keeps the input on errors, and highlights the field an error names.
function useSave(onSave: (fields: LetterFields) => Promise<void>) {
  const [error, setError] = useState<ApiError | null>(null)
  const errorId = useId()

  async function save(fields: LetterFields) {
    setError(null)
    try {
      await onSave(fields)
    } catch (caught) {
      setError(toApiError(caught))
    }
  }

  const control = (name: keyof LetterFields) => ({
    'aria-invalid': error?.field === name,
    'aria-describedby': error?.field === name ? errorId : undefined,
  })
  const alert = error && (
    <p role="alert" id={errorId}>
      {error.message}
    </p>
  )
  return { save, control, alert }
}

// Typed text saves when the user leaves the field or presses Enter, if it changed.
function commitOn(commit: () => void) {
  return {
    onBlur: commit,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter') commit()
    },
  }
}

export function Greeting({
  doc,
  readOnly,
  onSave,
}: {
  doc: DocDetail
  readOnly: boolean
  onSave: (fields: LetterFields) => Promise<void>
}) {
  const [addressee, setAddressee] = useState(doc.addressee ?? '')
  const { save, control, alert } = useSave(onSave)
  if (readOnly) return <p>{doc.addressee ? `Dear ${doc.addressee},` : 'No greeting.'}</p>
  const commit = () => {
    if (addressee !== (doc.addressee ?? '')) void save({ addressee: addressee || null })
  }
  return (
    <div className="stacked-form">
      <label>
        Addressed to (after &quot;Dear&quot;)
        <input
          {...control('addressee')}
          value={addressee}
          onChange={(event) => setAddressee(event.target.value)}
          {...commitOn(commit)}
        />
      </label>
      {alert}
    </div>
  )
}

const NEW_SIGN_OFF_ID = 'new-sign-off'

export function SignOffPart({
  doc,
  signOffs,
  headerName,
  readOnly,
  onSave,
  onWrite,
}: {
  doc: DocDetail
  signOffs: SignOff[]
  // The header's full_name, printed under the sign-off unless the letter gives another.
  headerName: string | null
  readOnly: boolean
  onSave: (fields: LetterFields) => Promise<void>
  // A new sign-off, saved to the library and used here; resolves to the letter's sign-off then.
  onWrite: (text: string) => Promise<number | null>
}) {
  const [signOffId, setSignOffId] = useState(doc.sign_off_id ?? null)
  const shownName = doc.signature_name ?? headerName ?? ''
  const [name, setName] = useState(shownName)
  const [writing, setWriting] = useState(false)
  const focusLater = useFocusLater()
  const { save, control, alert } = useSave(onSave)
  if (readOnly) {
    const text = signOffs.find((item) => item.sign_off_id === doc.sign_off_id)?.text
    return (
      <p>
        {text ? `${text},` : 'No sign-off.'} {shownName || "The header's name"}
      </p>
    )
  }
  const commitName = () => {
    const typed = name.trim()
    if (typed === shownName) return
    // The header's name (or nothing) is stored as empty, so it follows the header.
    const value = typed === '' || typed === headerName ? null : typed
    if (value !== doc.signature_name) void save({ signature_name: value })
    if (typed === '') setName(headerName ?? '')
  }
  function closeWriting() {
    setWriting(false)
    focusLater(NEW_SIGN_OFF_ID)
  }
  return (
    <div className="stacked-form">
      <label>
        Sign-off
        <select
          {...control('sign_off_id')}
          value={signOffId ?? ''}
          onChange={(event) => {
            const chosen = event.target.value ? Number(event.target.value) : null
            setSignOffId(chosen)
            void save({ sign_off_id: chosen })
          }}
        >
          <option value="">No sign-off</option>
          {signOffs.map((signOff) => (
            <option key={signOff.sign_off_id} value={signOff.sign_off_id}>
              {signOff.text}
            </option>
          ))}
        </select>
      </label>
      {writing ? (
        <NameForm
          label="New sign-off"
          field="text"
          submitLabel="Add sign-off"
          onSave={async (text) => {
            setSignOffId(await onWrite(text))
            closeWriting()
          }}
          onCancel={closeWriting}
        />
      ) : (
        <div className="actions">
          <button type="button" id={NEW_SIGN_OFF_ID} onClick={() => setWriting(true)}>
            New sign-off
          </button>
        </div>
      )}
      <label>
        Name under the sign-off
        <input
          {...control('signature_name')}
          value={name}
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
          {...commitOn(commitName)}
        />
      </label>
      {alert}
    </div>
  )
}
