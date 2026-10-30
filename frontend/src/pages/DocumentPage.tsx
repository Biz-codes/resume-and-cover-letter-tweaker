// One resume or cover letter, built in place: its tone at the top, then a tree whose levels open
// and close (Header; Sections, each opening to its items, and those to their skills and bullets;
// and for a letter, Greeting and Sign-off), then its plain text to preview and copy
// (docs/APP_FLOW.md, "Output"). Renaming, copying, and deleting sit under its name. See
// "Versions" and "Sent versions are locked" in docs/FRONTEND_CHECKS.md: a sent version is shown
// read-only and can only be renamed, and a base version is shown read-only until the user
// chooses to edit it in place rather than copy it, once per version each time the app is opened.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { toApiError, type ApiError } from '../api/client'
import { docsApi, fieldsOf, KINDS, type DocDetail, type DocFields, type DocKind } from '../api/documents'
import { headersApi, type Header } from '../api/headers'
import { signOffsApi, type SignOff } from '../api/signOffs'
import { toneSetsApi, type ToneSet } from '../api/toneSets'
import ConfirmDelete from '../components/ConfirmDelete'
import Disclosure from '../components/Disclosure'
import DocumentTree from '../components/DocumentTree'
import HeaderFields from '../components/HeaderFields'
import { Greeting, SignOffPart } from '../components/LetterParts'
import NameForm from '../components/NameForm'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'
import type { ListState } from './DocumentsPage'

// Base versions the user chose to edit in place since the app was opened, so the warning
// isn't repeated ("Warn before editing a base resume / cover letter").
const editingInPlace = new Set<string>()

// The buttons that open each form, where focus returns when it closes, the tone picker, where
// focus goes once editing starts, and "Edit this one", where it goes once editing is done.
const BUTTON_IDS = { rename: 'doc-rename', copy: 'doc-copy', delete: 'doc-delete' }
const TONE_ID = 'doc-tone'
const EDIT_ID = 'doc-edit'

type Mode = 'rename' | 'copy' | 'delete'

const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1)

// Shown on a base version until the user chooses: edits can't be undone.
function BaseWarning({ singular, onEdit, onCopy }: { singular: string; onEdit: () => void; onCopy: () => void }) {
  const questionId = useId()
  return (
    <div className="confirm" role="group" aria-labelledby={questionId}>
      <p id={questionId}>
        This is a base {singular}, so changes save right away and its earlier state can't be recovered. Edit it in
        place, or make a copy to edit instead?
      </p>
      <div className="actions">
        <button type="button" id={EDIT_ID} onClick={onEdit}>
          Edit this one
        </button>
        <button type="button" onClick={onCopy}>
          Make a copy instead
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
  const [toneError, setToneError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [inPlace, setInPlace] = useState(() => editingInPlace.has(`${kind}-${id}`))
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

  function close(returnTo: Mode) {
    setMode(null)
    focusLater(BUTTON_IDS[returnTo])
  }

  function editInPlace() {
    editingInPlace.add(`${kind}-${id}`)
    setInPlace(true)
    focusLater(TONE_ID)
  }

  // Back to showing it, as before editing. Every change is already saved.
  function doneEditing() {
    editingInPlace.delete(`${kind}-${id}`)
    setInPlace(false)
    setNotice(`Done editing. Your changes to this ${singular} are saved.`)
    focusLater(EDIT_ID)
  }

  // Saves some of the document's own fields, keeping the rest. Changes save as they're made, so
  // saves run one at a time, each from the document as the last one left it, and two quick changes
  // in a row don't undo each other.
  const latest = useRef(doc)
  useEffect(() => {
    latest.current = doc
  }, [doc])
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  function inTurn(save: (current: DocDetail) => Promise<DocDetail>, saved: string) {
    const run = queue.current
      .catch(() => undefined)
      .then(async () => {
        if (!latest.current) return
        const next = await save(latest.current)
        latest.current = next
        setDoc(next)
        setNotice(saved)
      })
    queue.current = run
    return run
  }
  const update = (changes: Partial<DocFields>, saved: string) =>
    inTurn((current) => docsApi(kind).update(id, { ...fieldsOf(kind, current), ...changes }), saved)

  async function rename(name: string) {
    await update({ name }, 'Renamed.')
    close('rename')
  }

  async function changeTone(toneSetId: number | null) {
    setToneError(null)
    try {
      await update({ tone_set_id: toneSetId }, 'Tone saved.')
    } catch (error) {
      setToneError(toApiError(error))
    }
  }

  async function saveHeader(fields: Parameters<ReturnType<typeof docsApi>['setHeader']>[1]) {
    await inTurn(() => docsApi(kind).setHeader(id, fields), 'Header saved.')
    // A new combination of values is a new saved header.
    setHeaders(await headersApi.list())
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
  // Sent versions never change; base versions wait for the user's choice.
  const needsChoice = Boolean(doc && !doc.locked && !doc.job_posting && !inPlace)
  const readOnly = !doc || doc.locked || needsChoice

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

          {mode === 'rename' && (
            <NameForm
              label={`New name for "${doc.name}"`}
              field="name"
              initial={doc.name}
              submitLabel="Rename"
              onSave={(name) => rename(name)}
              onCancel={() => close('rename')}
            />
          )}
          {mode === 'copy' && (
            <NameForm
              label="Name of the copy"
              field="name"
              initial={`Copy of ${doc.name}`.slice(0, 100)}
              lockedNote={`The copy is a new base ${singular} with the same tone, header, sections, and selections.`}
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
              <button type="button" id={BUTTON_IDS.rename} onClick={() => open('rename')}>
                Rename
              </button>
              <button type="button" id={BUTTON_IDS.copy} onClick={() => open('copy')}>
                Make a copy
              </button>
              {inPlace && !readOnly && (
                <button type="button" onClick={doneEditing}>
                  Done editing
                </button>
              )}
              <button type="button" id={BUTTON_IDS.delete} onClick={() => open('delete')}>
                Delete
              </button>
            </div>
          )}

          <h3>Contents</h3>
          {needsChoice && mode !== 'copy' && (
            <BaseWarning singular={singular} onEdit={editInPlace} onCopy={() => open('copy')} />
          )}
          {readOnly ? (
            <p>Tone: {toneSet?.name ?? 'None'}</p>
          ) : (
            <label className="tone">
              Tone
              <select
                id={TONE_ID}
                value={doc.tone_set_id ?? ''}
                aria-invalid={Boolean(toneError)}
                onChange={(event) => void changeTone(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">None</option>
                {toneSets.map((item) => (
                  <option key={item.tone_set_id} value={item.tone_set_id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {toneError && <p role="alert">{toneError.message}</p>}

          <ul className="tree">
            <li>
              <Disclosure title="Header">
                <HeaderFields header={header} headers={headers} readOnly={readOnly} onSave={saveHeader} />
              </Disclosure>
            </li>
            <li>
              <Disclosure title={`Sections (${doc.sections.length})`}>
                <DocumentTree kind={kind} doc={doc} readOnly={readOnly} onChange={setDoc} onNotice={setNotice} />
              </Disclosure>
            </li>
            {kind === 'cover_letter' && (
              <>
                <li>
                  <Disclosure title="Greeting">
                    <Greeting
                      doc={doc}
                      readOnly={readOnly}
                      onSave={(fields) => update(fields, 'Greeting saved.')}
                    />
                  </Disclosure>
                </li>
                <li>
                  <Disclosure title="Sign-off">
                    <SignOffPart
                      doc={doc}
                      signOffs={signOffs}
                      readOnly={readOnly}
                      onSave={(fields) => update(fields, 'Sign-off saved.')}
                    />
                  </Disclosure>
                </li>
              </>
            )}
          </ul>

          <h3>Preview and copy</h3>
          <p className="muted">
            Copy it into your own document or an application form.
            {kind === 'cover_letter' && " The section names are for you only; they aren't part of the letter."}
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
