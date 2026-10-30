// A cover letter's greeting and sign-off, each a level of the letter's tree. Each change saves right
// away: a choice when it's made, typed text when the user leaves the field or presses Enter.
// Read-only, they show what the letter prints. See "Default greeting" and "Default sign-off" in
// docs/FRONTEND_CHECKS.md.
import { useId, useState, type KeyboardEvent } from 'react'
import { toApiError, type ApiError } from '../api/client'
import type { DocDetail, DocFields } from '../api/documents'
import type { SignOff } from '../api/signOffs'

type LetterFields = Partial<Pick<DocFields, 'addressee' | 'sign_off_id' | 'signature_name'>>

// Saves one change, keeps the input on errors, and highlights the field an error names.
function useSave(onSave: (fields: LetterFields) => Promise<void>) {
  const [error, setError] = useState<ApiError | null>(null)
  const errorId = useId()
  const hintId = useId()

  async function save(fields: LetterFields) {
    setError(null)
    try {
      await onSave(fields)
    } catch (caught) {
      setError(toApiError(caught))
    }
  }

  // Typed fields are described by the hint, so how they save is read with them.
  const control = (name: keyof LetterFields, typed = false) => ({
    'aria-invalid': error?.field === name,
    'aria-describedby': [typed && hintId, error?.field === name && errorId].filter(Boolean).join(' ') || undefined,
  })
  const hint = (text: string) => (
    <p className="muted" id={hintId}>
      {text}
    </p>
  )
  const alert = error && (
    <p role="alert" id={errorId}>
      {error.message}
    </p>
  )
  return { save, control, alert, hint }
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
  const { save, control, alert, hint } = useSave(onSave)
  if (readOnly) return <p>{doc.addressee ? `Dear ${doc.addressee},` : 'No greeting.'}</p>
  const commit = () => {
    if (addressee !== (doc.addressee ?? '')) void save({ addressee: addressee || null })
  }
  return (
    <div className="stacked-form">
      {hint('Saves when you leave the field or press Enter.')}
      <label>
        Who it's addressed to, after "Dear" (leave empty for no greeting)
        <input
          {...control('addressee', true)}
          value={addressee}
          onChange={(event) => setAddressee(event.target.value)}
          {...commitOn(commit)}
        />
      </label>
      {alert}
    </div>
  )
}

export function SignOffPart({
  doc,
  signOffs,
  readOnly,
  onSave,
}: {
  doc: DocDetail
  signOffs: SignOff[]
  readOnly: boolean
  onSave: (fields: LetterFields) => Promise<void>
}) {
  const [signOffId, setSignOffId] = useState(doc.sign_off_id ?? null)
  const [name, setName] = useState(doc.signature_name ?? '')
  const { save, control, alert, hint } = useSave(onSave)
  if (readOnly) {
    const text = signOffs.find((item) => item.sign_off_id === doc.sign_off_id)?.text
    return (
      <p>
        {text ? `${text},` : 'No sign-off.'} {doc.signature_name ?? "The header's name"}
      </p>
    )
  }
  const commitName = () => {
    if (name !== (doc.signature_name ?? '')) void save({ signature_name: name || null })
  }
  return (
    <div className="stacked-form">
      {hint('The sign-off saves when you choose it, and the name when you leave its field or press Enter.')}
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
      <label>
        Name under the sign-off (leave empty to use the header's name)
        <input
          {...control('signature_name', true)}
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
