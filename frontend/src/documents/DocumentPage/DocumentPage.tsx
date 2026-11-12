// One resume or cover letter, built in place: its tone at the top, then a tree whose levels open
// and close (Header; Sections, each opening to its items, and those to their skills and bullets;
// and for a letter, Greeting and Sign-off), then its plain text to preview and copy
// (docs/APP_FLOW.md, "Output"). A version for a posting shows the posting's header, which is
// changed on the posting. A note on what editing does, and Copy and Delete (a sent one: Hide or
// Unhide), sit under its title; its title is changed under Contents, in a modal opened by "New
// title". See "Versions" and "Sent versions are locked" in docs/FRONTEND_CHECKS.md: a base version
// or one in progress is edited in place, and a sent one is shown read-only and can only be renamed.
// A posting's version Claude started shows Claude's draft (DraftTree) in place of its tree until its
// first review is finished; each change saves the draft, and Undo and Redo cover those too.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { toApiError, type ApiError } from '../../shared/api/client'
import {
  capitalize,
  copyName,
  docsApi,
  fieldsOf,
  KINDS,
  shownName,
  treeShape,
  type DocDetail,
  type DocFields,
  type DocKind,
  type DraftSection,
} from '../../shared/api/documents'
import { headersApi, type Header } from '../../shared/api/headers'
import { signOffsApi, type SignOff } from '../../shared/api/signOffs'
import { toneSetsApi, type ToneSet } from '../../shared/api/toneSets'
import { toneLabels } from '../../library/items/itemFields'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import Disclosure from '../../shared/components/Disclosure/Disclosure'
import DocumentTree from '../DocumentTree/DocumentTree'
import DraftTree, { DraftGreeting } from '../DraftTree/DraftTree'
import ChatPanel from '../ChatPanel/ChatPanel'
import ProposalCards from '../ProposalCards/ProposalCards'
import { chatApi, type ChatAbout, type ChatMessage } from '../../shared/api/chat'
import HeaderFields from '../../shared/components/HeaderFields'
import { Greeting, SignOffPart } from '../LetterParts'
import NameForm from '../../shared/components/NameForm/NameForm'
import { PAGE_HEADING_ID, useFocusLater } from '../../shared/hooks/useFocusLater'
import { usePageTitle } from '../../shared/hooks/usePageTitle'
import type { ListState } from '../DocumentsPage'
import styles from './DocumentPage.module.css'
import { offered } from '../../shared/offered'
import { postingName } from '../../postings/postings'
import { sortByName } from '../../shared/sortByName'
import AlertDialog from '../../shared/components/Dialog/AlertDialog'
import Dialog from '../../shared/components/Dialog/Dialog'

// The buttons that open each form, where focus returns when it closes.
const BUTTON_IDS = { copy: 'doc-copy', delete: 'doc-delete', title: 'doc-title' }
const TONE_ID = 'doc-tone'
const CHAT_BUTTON_ID = 'doc-chat'

type Mode = 'copy' | 'delete' | 'title'

// What editing does, above the buttons: one in progress saves as it's edited, and a sent one
// keeps everything but its name.
function EditNote({ singular, sent, draft }: { singular: string; sent: boolean; draft: boolean }) {
  return sent ? (
    <div className="note">
      <p>
        This {singular} has already been sent with a submitted application, so the only field you can edit is the title
        below.
      </p>
      <p>If you want to use this {singular} as a template for a new application, select "Copy".</p>
    </div>
  ) : draft ? (
    // Claude's draft is only reviewed, not edited, and isn't a version yet, so there's nothing
    // to copy.
    <div className="note">
      <p>
        Below is Claude&apos;s draft. Nothing is saved to this {singular} or your library until you approve the first
        draft.
      </p>
      <p>
        The purpose of this draft is just to accept or reject Claude&apos;s initial suggestions, so that suggestions you
        discard on a first pass don&apos;t clutter your library. After approving this first draft, you will be able to
        fine tune the entire {singular} in collaboration with Claude.
      </p>
      <p>The undo and redo buttons can make changes only while you stay on this page.</p>
    </div>
  ) : (
    <div className="note">
      <p>Edits to the {singular} below save instantly.</p>
      <p>The undo and redo buttons can make changes only while you stay on this page.</p>
      <p>If you want to preserve this version, select "Copy" instead.</p>
      <p>The versions already attached to a submitted application will not be changed.</p>
    </div>
  )
}

export function DocumentPage({ kind, id }: { kind: DocKind; id: number }) {
  const { path, singular, plural, title: kindTitle } = KINDS[kind]
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
  const [hiding, setHiding] = useState(false)
  const [hideError, setHideError] = useState<ApiError | null>(null)
  // The chat beside the document, while it's open: what the next message is about, the button that
  // opened it (focus goes back there when it closes), and a count that moves focus into it each
  // time an Ask Claude button is pressed, even when it's already open.
  const [chat, setChat] = useState<{ about: ChatAbout; returnTo: string; request: number } | null>(null)
  // Counts questions asked in an item's dialog, so an open chat panel reads them in.
  const [chatVersion, setChatVersion] = useState(0)
  const focusLater = useFocusLater()
  // A base version's title ends in "Base Resume", one for a posting's in "Resume".
  const titleKind = doc && !doc.job_posting ? `Base ${kindTitle}` : kindTitle
  const title = doc ? `${doc.name} ${titleKind}` : capitalize(singular)
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

  // A notice sent with the move here (a new or copied version) opens once the page has rendered and
  // App has moved focus to its heading, so OK returns focus there.
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

  // Hide and Unhide keep focus on their button, whose text changes. Hiding changes nothing it shows,
  // so it isn't a change to undo.
  async function setHidden(current: DocDetail, hidden: boolean) {
    if (hiding) return
    setHiding(true)
    setHideError(null)
    try {
      await docsApi(kind).setHidden(id, hidden)
      const next = { ...current, hidden }
      latest.current = next
      setDoc(next)
      setNotice(`${hidden ? 'Hid' : 'Unhid'} "${shownName(kind, current)}".`)
    } catch (error) {
      setHideError(toApiError(error))
    } finally {
      setHiding(false)
    }
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
        const draftOf = (one: DocDetail) => ({ sections: one.draft?.sections, usual: one.draft?.greeting?.use_default })
        if (target.draft && JSON.stringify(draftOf(current)) !== JSON.stringify(draftOf(target))) {
          next = await api.saveDraft(id, target.draft.sections, target.draft.greeting?.use_default)
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

  // The modal closes as the notice opens, so the notice never shows over it; focus goes back to
  // "New title" once the notice closes.
  async function rename(name: string) {
    await inTurn(
      (current) => docsApi(kind).update(id, { ...fieldsOf(kind, current), name }),
      `Renamed to "${name} ${titleKind}".`,
      (next) => {
        record(next)
        close('title')
      },
    )
  }

  // The draft announces its own changes. Each change sends the whole draft: its tree, and for a
  // letter, whether it keeps its usual greeting.
  const saveDraft = (sections: DraftSection[]) =>
    inTurn((current) => docsApi(kind).saveDraft(id, sections, current.draft?.greeting?.use_default), '')
  const saveGreeting = (useDefault: boolean) =>
    inTurn((current) => docsApi(kind).saveDraft(id, current.draft?.sections ?? [], useDefault), '')

  // Finishing saves to the library, which Undo never takes back, so the history starts again.
  const finishReview = (keep: number[]) =>
    inTurn(
      () => docsApi(kind).finishReview(id, keep),
      keep.length
        ? `Approved the first draft. The ${singular} has what you kept, and Claude's text you kept for later is in your library.`
        : `Approved the first draft. The ${singular} has what you kept.`,
      (next) => {
        setStacks([], [])
        latest.current = next
        setDoc(next)
      },
    )

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
      state: { notice: `Copied to "${shownName(kind, copied)}". The original is unchanged.` },
    })
  }

  async function confirmDelete(current: DocDetail) {
    setDeleteError(null)
    try {
      await docsApi(kind).delete(id)
      // Back to the page it was opened from, or the list.
      navigate((location.state as ListState | null)?.back ?? path, {
        state: { notice: `Deleted "${shownName(kind, current)}".` } satisfies ListState,
      })
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

  const openChat = (about: ChatAbout, returnTo: string) =>
    setChat((current) => ({ about, returnTo, request: (current?.request ?? 0) + 1 }))
  function closeChat() {
    if (chat) focusLater(chat.returnTo)
    setChat(null)
  }
  // Applying one of Claude's proposals is an ordinary change, kept for Undo and made in turn with
  // the others; the cards announce it themselves.
  async function applyProposal(messageId: number, proposalId: string): Promise<ChatMessage> {
    let message: ChatMessage | undefined
    await inTurn(async () => {
      const applied = await chatApi(kind).apply(id, messageId, proposalId)
      message = applied.message
      return applied.document
    }, '')
    if (!message) throw new Error('The change was not applied.')
    return message
  }
  const proposalState = (messageId: number, proposalId: string, state: 'pending' | 'dismissed') =>
    chatApi(kind).setState(id, messageId, proposalId, state)

  const wholeDocument: ChatAbout = { level: 'document', label: `the whole ${singular}` }
  // What a question can be widened to: an item's section, then the whole document.
  function wider(about: ChatAbout): ChatAbout[] {
    if (about.level === 'document') return []
    const section = doc?.sections.find((placed) => placed.section_id === about.section_id)
    const sectionAbout: ChatAbout = { level: 'section', label: `the ${section?.title ?? ''} section`, section_id: about.section_id }
    return about.level === 'item' ? [sectionAbout, wholeDocument] : [wholeDocument]
  }

  const header = headers.find((item) => item.header_id === doc?.header_id)
  const toneSet = toneSets.find((item) => item.tone_set_id === doc?.tone_set_id)
  // Tones with the same name show when each was added.
  const toneLabel = toneLabels(toneSets)
  // Sent versions never change.
  const readOnly = !doc || doc.locked

  return (
    <section>
      <p className={styles.backLinks}>
        <Link to={path}>All {plural.toLowerCase()}</Link>
        {doc?.job_posting && <Link to={`/postings/${doc.job_posting.job_posting_id}`}>Back to job posting</Link>}
      </p>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        {title}
      </h2>
      <AlertDialog message={notice} onClose={() => setNotice(null)} />
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
        <div className={chat ? styles.withChat : undefined}>
        <div className={styles.mainColumn}>
          {(doc.locked || doc.hidden) && (
            <p>
              {doc.locked && <span className="tag">sent</span>}
              {doc.hidden && <span className="tag">hidden</span>}
            </p>
          )}
          {doc.based_on && (
            <p className="muted">
              Copied from <Link to={`${path}/${doc.based_on.id}`}>{doc.based_on.name}</Link>
            </p>
          )}
          <EditNote singular={singular} sent={doc.locked} draft={Boolean(doc.draft)} />

          {mode === 'copy' && copyNameFor !== null && (
            <NameForm
              label="Name of the copy"
              field="name"
              initial={copyNameFor ?? `Copy of ${doc.name}`.slice(0, 204)}
              suffix={`Base ${kindTitle}`}
              submitLabel="Make copy"
              onSave={copy}
              onCancel={() => close('copy')}
            />
          )}
          {mode === 'delete' && (
            <ConfirmDelete
              // Named by kind and posting, so it isn't mistaken for the posting's own delete.
              what={
                doc.job_posting
                  ? `${singular} for ${postingName(doc.job_posting)}`
                  : `${singular} "${shownName(kind, doc)}"`
              }
              noun={singular}
              uses={doc.copies}
              usesLabel="Copies made from it"
              effect="They're kept."
              error={deleteError}
              onConfirm={() => void confirmDelete(doc)}
              onCancel={() => close('delete')}
            />
          )}
          {mode === null && (
            <div className="actions">
              {/* The chat comes after Claude's first draft is approved. */}
              {!doc.draft && (
                <button type="button" id={CHAT_BUTTON_ID} onClick={() => openChat(wholeDocument, CHAT_BUTTON_ID)}>
                  Chat with Claude
                </button>
              )}
              {/* Named for what it makes, since the page's other Copy buttons copy text. Claude's
                  draft isn't a version yet, so there's nothing to copy. */}
              {!doc.draft && (
                <button
                  type="button"
                  id={BUTTON_IDS.copy}
                  aria-label={`Copy to a new base ${singular}`}
                  onClick={() => void openCopy()}
                >
                  Copy
                </button>
              )}
              {doc.locked ? (
                // aria-disabled, not disabled, so the button keeps focus while it saves.
                <button type="button" aria-disabled={hiding} onClick={() => void setHidden(doc, !doc.hidden)}>
                  {doc.hidden ? (hiding ? 'Unhiding…' : 'Unhide') : hiding ? 'Hiding…' : 'Hide'}
                </button>
              ) : (
                <button type="button" id={BUTTON_IDS.delete} onClick={() => open('delete')}>
                  Delete {singular}
                </button>
              )}
            </div>
          )}
          {hideError && <p role="alert">{hideError.message}</p>}

          <h3>Contents</h3>
          <div className={styles.title}>
            <p>Title</p>
            <p>{title}</p>
            <button type="button" id={BUTTON_IDS.title} onClick={() => open('title')}>
              New title
            </button>
          </div>
          {mode === 'title' && (
            <Dialog title="New title" onClose={() => close('title')}>
              <NameForm
                label="Title"
                field="name"
                initial={doc.name}
                suffix={titleKind}
                focusOnOpen={false}
                onSave={rename}
                onCancel={() => close('title')}
              />
            </Dialog>
          )}
          {readOnly ? (
            <p>Tone: {toneSet ? toneLabel(toneSet) : 'None'}</p>
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
                {sortByName(offered(toneSets, (item) => item.tone_set_id === doc.tone_set_id), toneLabel).map((item) => (
                  <option key={item.tone_set_id} value={item.tone_set_id}>
                    {toneLabel(item)}
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
              {/* Claude's draft starts open, since it's what there is to do first. */}
              <Disclosure title={`Sections (${(doc.draft ?? doc).sections.length})`} initiallyOpen={Boolean(doc.draft)}>
                {doc.draft && !readOnly ? (
                  <DraftTree kind={kind} draft={doc.draft} ownSections={doc.sections} onChange={saveDraft} onFinish={finishReview} />
                ) : (
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
                    onAsk={readOnly ? undefined : openChat}
                    onChatSent={() => setChatVersion((count) => count + 1)}
                  />
                )}
              </Disclosure>
            </li>
            {kind === 'cover_letter' && (
              <>
                <li>
                  {/* Claude's greeting waits in the draft, which approving saves. */}
                  <Disclosure title="Greeting" initiallyOpen={Boolean(doc.draft?.greeting && !readOnly)}>
                    {doc.draft?.greeting && !readOnly ? (
                      <DraftGreeting greeting={doc.draft.greeting} usual={doc.addressee ?? null} onChange={saveGreeting} />
                    ) : (
                      <Greeting
                        key={restored}
                        doc={doc}
                        readOnly={readOnly}
                        onSave={(fields) => update(fields, 'Greeting saved.')}
                      />
                    )}
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
        </div>
        {chat && (
          <ChatPanel
            kind={kind}
            docId={id}
            locked={doc.locked}
            about={chat.about}
            wider={wider(chat.about)}
            onAbout={(about) => setChat({ ...chat, about })}
            onClose={closeChat}
            focusRequest={chat.request}
            version={chatVersion}
            proposals={(message, { update, announce }) => (
              <ProposalCards
                message={message}
                sections={doc.sections}
                readOnly={doc.locked}
                onApply={applyProposal}
                onState={proposalState}
                onUpdate={update}
                announce={announce}
              />
            )}
          />
        )}
        </div>
      )}
    </section>
  )
}

// The route's page: a new DocumentPage for each id, so moving to a copy starts fresh.
export default function DocumentRoute({ kind }: { kind: DocKind }) {
  const { id } = useParams()
  return <DocumentPage key={id} kind={kind} id={Number(id)} />
}
