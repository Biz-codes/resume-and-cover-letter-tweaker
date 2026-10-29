// One resume or cover letter: its details (header, tone set, and a letter's greeting and
// sign-off), its plain-text output with copy buttons (docs/APP_FLOW.md, "Output"), and editing,
// copying, and deleting it, per "Versions" and "Sent versions are locked" in
// docs/FRONTEND_CHECKS.md. A sent version can only be renamed. Editing a base version first warns
// that the change can't be undone, once per version each time the app is opened.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { toApiError, type ApiError } from '../api/client'
import { docsApi, fieldsOf, KINDS, type DocDetail, type DocFields, type DocKind } from '../api/documents'
import { headersApi, type Header } from '../api/headers'
import { signOffsApi, type SignOff } from '../api/signOffs'
import { toneSetsApi, type ToneSet } from '../api/toneSets'
import ConfirmDelete from '../components/ConfirmDelete'
import NameForm from '../components/NameForm'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'
import type { ListState } from './DocumentsPage'

// Base versions the user chose to edit in place since the app was opened, so the warning
// isn't repeated ("Warn before editing a base resume / cover letter").
const editingInPlace = new Set<string>()

// The buttons that open each form, where focus returns when it closes.
const BUTTON_IDS = { edit: 'doc-edit', copy: 'doc-copy', delete: 'doc-delete' }

type Mode = 'warn' | 'edit' | 'copy' | 'delete'

const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1)

// Names a header in a list of headers; several can share a name and headline.
const headerName = (header: Header) =>
  [header.full_name, header.headline, header.email ?? header.phone].filter(Boolean).join(', ')

function DetailsForm({
  kind,
  doc,
  headers,
  toneSets,
  signOffs,
  onSave,
  onCancel,
}: {
  kind: DocKind
  doc: DocDetail
  headers: Header[]
  toneSets: ToneSet[]
  signOffs: SignOff[]
  onSave: (fields: DocFields) => Promise<void>
  onCancel: () => void
}) {
  const [fields, setFields] = useState(fieldsOf(kind, doc))
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const errorId = useId()
  const noteId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const letter = kind === 'cover_letter'

  useEffect(() => formRef.current?.querySelector('input')?.focus(), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(fields)
    } catch (caught) {
      setError(toApiError(caught))
    } finally {
      setSaving(false)
    }
  }

  // Links a field to the error that names it (and the name field to the locked note).
  const control = (name: keyof DocFields) => ({
    name,
    'aria-invalid': error?.field === name,
    'aria-describedby':
      [doc.locked && name === 'name' ? noteId : null, error?.field === name ? errorId : null]
        .filter(Boolean)
        .join(' ') || undefined,
  })
  const text = (name: 'addressee' | 'signature_name') => ({
    ...control(name),
    value: fields[name] ?? '',
    onChange: (event: { target: { value: string } }) => setFields({ ...fields, [name]: event.target.value }),
  })
  const choice = (name: 'header_id' | 'tone_set_id' | 'sign_off_id') => ({
    ...control(name),
    value: fields[name] ?? '',
    onChange: (event: { target: { value: string } }) =>
      setFields({ ...fields, [name]: event.target.value ? Number(event.target.value) : null }),
  })

  return (
    <form className="card" ref={formRef} onSubmit={submit} aria-label={`Edit details of "${doc.name}"`}>
      {doc.locked && (
        <p className="note" id={noteId}>
          This {KINDS[kind].singular} was sent, so only its name can change.
        </p>
      )}
      <label>
        Name (required)
        <input
          {...control('name')}
          value={fields.name}
          aria-required="true"
          onChange={(event) => setFields({ ...fields, name: event.target.value })}
        />
      </label>
      {!doc.locked && (
        <>
          <label>
            Header
            <select {...choice('header_id')}>
              <option value="">No header</option>
              {headers.map((header) => (
                <option key={header.header_id} value={header.header_id}>
                  {headerName(header)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tone set
            <select {...choice('tone_set_id')}>
              <option value="">No tone set</option>
              {toneSets.map((toneSet) => (
                <option key={toneSet.tone_set_id} value={toneSet.tone_set_id}>
                  {toneSet.name}
                </option>
              ))}
            </select>
          </label>
          {letter && (
            <>
              <label>
                Greeting: who it's addressed to, after "Dear"
                <input {...text('addressee')} />
              </label>
              <label>
                Sign-off
                <select {...choice('sign_off_id')}>
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
                <input {...text('signature_name')} autoComplete="name" />
              </label>
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" id={errorId}>
          {error.message}
        </p>
      )}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="submit" aria-disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// The warning before the first edit of a base version: edits can't be undone.
function BaseWarning({
  singular,
  onEdit,
  onCopy,
  onCancel,
}: {
  singular: string
  onEdit: () => void
  onCopy: () => void
  onCancel: () => void
}) {
  const questionId = useId()
  const copyRef = useRef<HTMLButtonElement>(null)

  // The safe choice takes focus.
  useEffect(() => copyRef.current?.focus(), [])

  return (
    <div className="confirm" role="group" aria-labelledby={questionId}>
      <p id={questionId}>
        This is a base {singular}, so edits change it in place and its earlier state can't be recovered.
        Edit it anyway, or make a copy to edit instead?
      </p>
      <div className="actions">
        <button type="button" onClick={onEdit}>
          Edit this one
        </button>
        <button type="button" ref={copyRef} onClick={onCopy}>
          Make a copy instead
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function DocumentPage({ kind, id }: { kind: DocKind; id: number }) {
  const { path, singular, plural } = KINDS[kind]
  const location = useLocation()
  const navigate = useNavigate()
  const [doc, setDoc] = useState<DocDetail | null>(null)
  const [headers, setHeaders] = useState<Header[]>([])
  const [toneSets, setToneSets] = useState<ToneSet[]>([])
  const [signOffs, setSignOffs] = useState<SignOff[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle(doc?.name ?? capitalize(singular))

  const load = useCallback(
    () =>
      Promise.all([
        docsApi(kind).get(id),
        headersApi.list(),
        toneSetsApi.list(),
        kind === 'cover_letter' ? signOffsApi.list() : Promise.resolve([]),
      ])
        .then(([loaded, headerList, toneSetList, signOffList]) => {
          setDoc(loaded)
          setHeaders(headerList)
          setToneSets(toneSetList)
          setSignOffs(signOffList)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [kind, id],
  )

  useEffect(() => {
    void load()
  }, [load])

  // A notice sent with the move here (a new or copied version) goes into the live region after
  // it's rendered, so screen readers announce it.
  const sentNotice = (location.state as ListState | null)?.notice ?? null
  useEffect(() => {
    const timer = setTimeout(() => setNotice(sentNotice))
    return () => clearTimeout(timer)
  }, [sentNotice])

  function open(next: Mode) {
    setMode(next)
    setNotice(null)
    setDeleteError(null)
  }

  function close(returnTo: keyof typeof BUTTON_IDS) {
    setMode(null)
    focusLater(BUTTON_IDS[returnTo])
  }

  function startEditing() {
    const key = `${kind}-${id}`
    open(doc?.job_posting || editingInPlace.has(key) ? 'edit' : 'warn')
  }

  async function save(fields: DocFields) {
    const saved = await docsApi(kind).update(id, fields)
    setDoc(saved)
    setNotice('Saved.')
    close('edit')
  }

  async function copy(name: string) {
    const copied = await docsApi(kind).copy(id, name)
    navigate(`${path}/${copied.id}`, {
      state: { notice: `Copied to a new base ${singular}, "${copied.name}". The original is unchanged.` },
    })
  }

  async function confirmDelete(current: DocDetail) {
    setDeleteError(null)
    try {
      await docsApi(kind).delete(id)
      navigate(path, { state: { notice: `Deleted "${current.name}".` } satisfies ListState })
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  async function copyText(text: string, what: string) {
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(text)
      setNotice(`Copied ${what}.`)
    } catch {
      setCopyError("Couldn't copy. Select the text and copy it yourself.")
    }
  }

  const header = headers.find((item) => item.header_id === doc?.header_id)
  const toneSet = toneSets.find((item) => item.tone_set_id === doc?.tone_set_id)
  const signOff = signOffs.find((item) => item.sign_off_id === doc?.sign_off_id)

  return (
    <section>
      <p>
        <Link to={path}>All {plural.toLowerCase()}</Link>
      </p>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        {doc?.name ?? capitalize(singular)}
      </h2>
      <p role="status">{notice}</p>
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          {loadError.code !== 'NOT_FOUND' && (
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          )}
        </div>
      )}
      {!doc && !loadError && <p>Loading…</p>}

      {doc && (
        <>
          <p>
            {doc.job_posting
              ? `For ${doc.job_posting.organization}: ${doc.job_posting.role_title}`
              : `Base ${singular}`}
            {doc.locked && <span className="tag">sent</span>}
          </p>
          {doc.based_on && (
            <p className="muted">
              Copied from <Link to={`${path}/${doc.based_on.id}`}>{doc.based_on.name}</Link>
            </p>
          )}
          {doc.locked && (
            <p className="note">
              This {singular} was sent, so it's a record of what went out. You can rename it, or make a copy to
              change it.
            </p>
          )}

          {mode === 'edit' ? (
            <DetailsForm
              kind={kind}
              doc={doc}
              headers={headers}
              toneSets={toneSets}
              signOffs={signOffs}
              onSave={save}
              onCancel={() => close('edit')}
            />
          ) : (
            <>
              <h3>Details</h3>
              <dl className="details-list">
                <dt>Header</dt>
                <dd>{header ? headerName(header) : 'None'}</dd>
                <dt>Tone set</dt>
                <dd>{toneSet?.name ?? 'None'}</dd>
                {kind === 'cover_letter' && (
                  <>
                    <dt>Greeting</dt>
                    <dd>{doc.addressee ? `Dear ${doc.addressee},` : 'None'}</dd>
                    <dt>Sign-off</dt>
                    <dd>{signOff?.text ?? 'None'}</dd>
                    <dt>Name under the sign-off</dt>
                    <dd>{doc.signature_name ?? "The header's name"}</dd>
                  </>
                )}
              </dl>
            </>
          )}

          {mode === 'warn' && (
            <BaseWarning
              singular={singular}
              onEdit={() => {
                editingInPlace.add(`${kind}-${id}`)
                setMode('edit')
              }}
              onCopy={() => setMode('copy')}
              onCancel={() => close('edit')}
            />
          )}
          {mode === 'copy' && (
            <NameForm
              label="Name of the copy"
              field="name"
              initial={`Copy of ${doc.name}`.slice(0, 100)}
              lockedNote={`The copy is a new base ${singular} with the same details, sections, and selections.`}
              submitLabel="Make copy"
              onSave={copy}
              onCancel={() => close('copy')}
            />
          )}
          {mode === 'delete' && (
            <ConfirmDelete
              what={`"${doc.name}"`}
              uses={doc.copies}
              usesLabel="Copies made from it"
              effect="They're kept."
              locked={doc.locked}
              lockedNote="This version was sent, so deleting it removes the record of what you sent."
              error={deleteError}
              onConfirm={() => void confirmDelete(doc)}
              onCancel={() => close('delete')}
            />
          )}
          {mode === null && (
            <div className="actions">
              <button type="button" id={BUTTON_IDS.edit} onClick={startEditing}>
                {doc.locked ? 'Rename' : 'Edit details'}
              </button>
              <button type="button" id={BUTTON_IDS.copy} onClick={() => open('copy')}>
                Make a copy
              </button>
              <button type="button" id={BUTTON_IDS.delete} onClick={() => open('delete')}>
                Delete
              </button>
            </div>
          )}

          <h3>Plain text</h3>
          <p className="muted">
            Copy it into your own document or an application form.
            {kind === 'cover_letter' && ' The section names are for you only; they aren\'t part of the letter.'}
          </p>
          {copyError && <p role="alert">{copyError}</p>}
          {doc.output.parts.length === 0 ? (
            <p>Nothing in this {singular} yet.</p>
          ) : (
            <>
              <button type="button" onClick={() => void copyText(doc.output.text, `the whole ${singular}`)}>
                Copy the whole {singular}
              </button>
              {doc.output.parts.map((part) => (
                <div key={part.label} className="output-part">
                  <div className="card-header">
                    <h4>{part.label}</h4>
                    <button
                      type="button"
                      aria-label={`Copy ${part.label}`}
                      onClick={() => void copyText(part.text, part.label)}
                    >
                      Copy
                    </button>
                  </div>
                  {part.text ? <pre>{part.text}</pre> : <p className="muted">Empty.</p>}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </section>
  )
}

// The route's page: a new DocumentPage for each id, so moving to a copy starts fresh.
export default function DocumentRoute({ kind }: { kind: DocKind }) {
  const { id } = useParams()
  return <DocumentPage key={id} kind={kind} id={Number(id)} />
}
