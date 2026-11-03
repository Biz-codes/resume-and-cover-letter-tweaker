// One resume or cover letter, built in place: its tone at the top, then a tree whose levels open
// and close (Header; Sections, each opening to its items, and those to their skills and bullets;
// and for a letter, Greeting and Sign-off), then its plain text to preview and copy
// (docs/APP_FLOW.md, "Output"). A version for a posting shows the posting's header, which is
// changed on the posting. Renaming, copying, "Done editing", and deleting sit under its
// name. See "Versions" and "Sent versions are locked" in docs/FRONTEND_CHECKS.md: a sent version
// is shown read-only and can only be renamed, and a base version is shown read-only until the
// user chooses to edit it in place rather than copy it, once per version while the app is open,
// until "Done editing" shows it read-only again.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { toApiError, type ApiError } from '../../shared/api/client'
import {
  capitalize,
  copyName,
  docsApi,
  fieldsOf,
  KINDS,
  treeShape,
  type DocDetail,
  type DocFields,
  type DocKind,
} from '../../shared/api/documents'
import { headersApi, type Header } from '../../shared/api/headers'
import { signOffsApi, type SignOff } from '../../shared/api/signOffs'
import { toneSetsApi, type ToneSet } from '../../shared/api/toneSets'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import Disclosure from '../../shared/components/Disclosure/Disclosure'
import DocumentTree from '../DocumentTree/DocumentTree'
import HeaderFields from '../../shared/components/HeaderFields'
import { Greeting, SignOffPart } from '../LetterParts'
import NameForm from '../../shared/components/NameForm/NameForm'
import { PAGE_HEADING_ID, useFocusLater } from '../../shared/hooks/useFocusLater'
import { usePageTitle } from '../../shared/hooks/usePageTitle'
import type { ListState } from '../DocumentsPage'
import styles from './DocumentPage.module.css'
import { offered } from '../../shared/offered'

// Base versions the user chose to edit in place since the app was opened, so the warning
// isn't repeated ("Warn before editing a base resume / cover letter").
const editingInPlace = new Set<string>()

// The buttons that open each form, where focus returns when it closes, the tone picker, where
// focus goes once editing starts, and "Edit this one", where it goes once editing is done.
const BUTTON_IDS = { rename: 'doc-rename', copy: 'doc-copy', delete: 'doc-delete' }
const TONE_ID = 'doc-tone'
const EDIT_ID = 'doc-edit'

type Mode = 'rename' | 'copy' | 'delete'

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
  const title = doc ? `${doc.name} ${capitalize(singular)}` : capitalize(singular)
  usePageTitle(title)

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

  // The copy form starts with a name no other one has, so it reads the names first, and opens
  // once it has one, so focus goes from Make a copy straight to the name. If reading them fails,
  // it starts from "Copy of", and the backend still refuses a name that's taken (DUPLICATE).
  const [copyNameFor, setCopyNameFor] = useState<string | null>(null)
  async function openCopy() {
    if (!doc) return
    const taken = await docsApi(kind)
      .list()
      .then((docs) => docs.map((other) => other.name))
      .catch(() => [])
    setCopyNameFor(copyName(doc.name, taken))
    open('copy')
  }

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

  // Undo and redo: the document as it was before each change since the page opened, and after
  // each one undone (docs/FRONTEND_CHECKS.md, "Undo"). Kept in a ref, so steps queued quickly
  // each take the next one; `historySize` redraws the buttons.
  const history = useRef<{ undo: DocDetail[]; redo: DocDetail[] }>({ undo: [], redo: [] })
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 })
  const [historyError, setHistoryError] = useState<ApiError | null>(null)
  // Counts undos and redos, so the parts that keep typed values of their own (the header, the
  // greeting, the sign-off) start again from the document they bring back.
  const [restored, setRestored] = useState(0)

  function setStacks(undo: DocDetail[], redo: DocDetail[]) {
    history.current = { undo, redo }
    setHistorySize({ undo: undo.length, redo: redo.length })
  }

  // Shows a saved change, and keeps what it replaced for Undo. A new change can't be redone past.
  function record(next: DocDetail) {
    if (latest.current) setStacks([...history.current.undo, latest.current], [])
    latest.current = next
    setDoc(next)
  }
  // A new sign-off is saved to the library too, so the list is read again.
  async function writeSignOff(text: string) {
    await inTurn(() => docsApi(kind).writeSignOff(id, text), 'Added the new sign-off.')
    setSignOffs(await signOffsApi.list())
    return latest.current?.sign_off_id ?? null
  }

  // `saved` is the notice, or for one that depends on the outcome, a function giving it after.
  function inTurn(
    save: (current: DocDetail) => Promise<DocDetail>,
    saved: string | (() => string),
    show = record,
  ) {
    const run = queue.current
      .catch(() => undefined)
      .then(async () => {
        if (!latest.current) return
        const next = await save(latest.current)
        show(next)
        setNotice(typeof saved === 'string' ? saved : saved())
      })
    queue.current = run
    return run
  }
  const update = (changes: Partial<DocFields>, saved: string) =>
    inTurn((current) => docsApi(kind).update(id, { ...fieldsOf(kind, current), ...changes }), saved)

  // Back (or forward again) one step: the fields and the tree that differ are sent back as they
  // were. Library items written since stay in the library.
  function step(direction: 'undo' | 'redo') {
    setHistoryError(null)
    inTurn(
      async (current) => {
        const { undo, redo } = history.current
        const target = (direction === 'undo' ? undo : redo).at(-1)
        if (!target) return current
        const api = docsApi(kind)
        let next = current
        if (JSON.stringify(fieldsOf(kind, current)) !== JSON.stringify(fieldsOf(kind, target))) {
          next = await api.update(id, fieldsOf(kind, target))
        }
        if (JSON.stringify(treeShape(current.sections)) !== JSON.stringify(treeShape(target.sections))) {
          next = await api.restoreTree(id, target.sections)
        }
        if (direction === 'undo') setStacks(undo.slice(0, -1), [...redo, current])
        else setStacks([...undo, current], redo.slice(0, -1))
        return next
      },
      // Says how many steps are left, so each press reads differently (a notice that repeats
      // the same text isn't announced again).
      () => {
        const left = history.current[direction].length
        return direction === 'undo'
          ? `Undid a change. ${left ? `${left} more can be undone.` : 'Nothing more to undo.'}`
          : `Redid a change. ${left ? `${left} more can be redone.` : 'Nothing more to redo.'}`
      },
      (next) => {
        latest.current = next
        setDoc(next)
        setRestored((count) => count + 1)
      },
    ).catch((error: unknown) => setHistoryError(toApiError(error)))
  }

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
      <p className={styles.backLinks}>
        <Link to={path}>All {plural.toLowerCase()}</Link>
        {doc?.job_posting && <Link to={`/postings/${doc.job_posting.job_posting_id}`}>Back to job posting</Link>}
      </p>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        {title}
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
          {(!doc.job_posting || doc.locked) && (
            <p>
              {!doc.job_posting && `Base ${singular}`}
              {doc.locked && <span className="tag">sent</span>}
            </p>
          )}
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
          {mode === 'copy' && copyNameFor !== null && (
            <NameForm
              label="Name of the copy"
              field="name"
              initial={copyNameFor ?? `Copy of ${doc.name}`.slice(0, 204)}
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
              <button type="button" id={BUTTON_IDS.copy} onClick={() => void openCopy()}>
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
            <BaseWarning singular={singular} onEdit={editInPlace} onCopy={() => void openCopy()} />
          )}
          {readOnly ? (
            <p>Tone: {toneSet?.name ?? 'None'}</p>
          ) : (
            <label className={styles.tone}>
              Tone
              <select
                id={TONE_ID}
                value={doc.tone_set_id ?? ''}
                aria-invalid={Boolean(toneError)}
                onChange={(event) => void changeTone(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">None</option>
                {offered(toneSets, (item) => item.tone_set_id === doc.tone_set_id).map((item) => (
                  <option key={item.tone_set_id} value={item.tone_set_id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {toneError && <p role="alert">{toneError.message}</p>}
          {!readOnly && (
            <>
              {/* aria-disabled, not disabled, so a focused button keeps focus when its list runs out. */}
              <div className="actions" role="group" aria-label="Undo and redo">
                <button
                  type="button"
                  aria-disabled={historySize.undo === 0}
                  onClick={() => historySize.undo > 0 && step('undo')}
                >
                  Undo
                </button>
                <button
                  type="button"
                  aria-disabled={historySize.redo === 0}
                  onClick={() => historySize.redo > 0 && step('redo')}
                >
                  Redo
                </button>
              </div>
              {historyError && <p role="alert">{historyError.message}</p>}
            </>
          )}

          <ul className={styles.tree}>
            <li>
              <Disclosure title={doc.job_posting ? 'Application header' : 'Header'}>
                {/* A version for a posting uses the posting's header, so it's changed there. */}
                <HeaderFields
                  key={restored}
                  header={header}
                  headers={offered(headers)}
                  readOnly={readOnly || Boolean(doc.job_posting)}
                  onSave={saveHeader}
                />
                {doc.job_posting && !doc.locked && (
                  <p>
                    <Link to={`/postings/${doc.job_posting.job_posting_id}`}>Change the application header on the posting</Link>
                  </p>
                )}
              </Disclosure>
            </li>
            <li>
              <Disclosure title={`Sections (${doc.sections.length})`}>
                <DocumentTree
                  kind={kind}
                  doc={doc}
                  readOnly={readOnly}
                  onChange={record}
                  onReload={(next) => {
                    latest.current = next
                    setDoc(next)
                  }}
                  onNotice={setNotice}
                />
              </Disclosure>
            </li>
            {kind === 'cover_letter' && (
              <>
                <li>
                  <Disclosure title="Greeting">
                    <Greeting
                      key={restored}
                      doc={doc}
                      readOnly={readOnly}
                      onSave={(fields) => update(fields, 'Greeting saved.')}
                    />
                  </Disclosure>
                </li>
                <li>
                  <Disclosure title="Sign-off">
                    <SignOffPart
                      key={restored}
                      doc={doc}
                      signOffs={signOffs}
                      headerName={header?.full_name ?? null}
                      readOnly={readOnly}
                      onSave={(fields) => update(fields, 'Sign-off saved.')}
                      onWrite={writeSignOff}
                    />
                  </Disclosure>
                </li>
              </>
            )}
          </ul>

          <Disclosure title="Preview and copy" heading={3}>
            {kind === 'cover_letter' && <p className="muted">Section names aren&apos;t printed in the letter.</p>}
            {copyError && <p role="alert">{copyError}</p>}
            {doc.output.parts.length === 0 ? (
              <p>Nothing in this {singular} yet.</p>
            ) : (
              <>
                <button type="button" onClick={() => void copyText(doc.output.text, `the whole ${singular}`)}>
                  Copy the whole {singular}
                </button>
                {doc.output.parts.map((part) => (
                  <div key={part.label} className={styles.outputPart}>
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
          </Disclosure>
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
