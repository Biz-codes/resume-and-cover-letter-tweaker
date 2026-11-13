// The first pass over Claude's draft of a posting's resume or cover letter, in place of its tree
// until the first draft is approved (docs/APP_FLOW.md, "Tailoring a posting's document"). It's
// only for accepting or rejecting Claude's suggestions, so what the user throws out never
// reaches the library; everything else is done after approving, in the usual tree.
//
// Each section, item, bullet, and skill is shown in Claude's order with a badge saying where it
// came from: "Original" (in the document Claude started from), "Library" (Claude brought it in
// from the library), or "Claude" (Claude's wording or new text). Under each, "Rationale" opens
// Claude's reason and, for a rewording, the other wording with a button to switch to it. What
// Claude brought in or wrote new can be rejected, which takes it out of the draft. A row whose
// wording in use breaks a writing rule (checked when the draft was made) is badged "Flagged",
// with each rule, the words, and why under its name.
//
// Each change saves the draft only (backend/app/drafts.py) and is announced here; Undo and Redo
// on the page cover them. "Approve first draft" first asks which of Claude's texts the draft
// doesn't use to keep in the library for later.
//
// A cover letter's draft can have new sections Claude titled for its new paragraphs (badged
// "Claude", and added to the library only if they're kept), and the greeting Claude suggests,
// which DraftGreeting shows in the letter's Greeting level.
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import {
  docsApi,
  KINDS,
  textsInUse,
  type ClaudeText,
  type DocKind,
  type Draft,
  type DraftBullet,
  type DraftEntry,
  type DraftGreeting as Greeting,
  type DraftSection,
  type TreeSection,
  type WritingFlag,
} from '../../shared/api/documents'
import Checklist from '../../shared/components/Checklist'
import Dialog from '../../shared/components/Dialog/Dialog'
import Disclosure from '../../shared/components/Disclosure/Disclosure'
import Flags from '../../shared/components/WritingFlags/WritingFlags'
import { flagCount } from '../../shared/components/WritingFlags/flagCount'
import { useFocusLater } from '../../shared/hooks/useFocusLater'
import { KIND_NAMES, keyOf, loadLibrary, savedItems, type Library } from '../treeItems'
import styles from './DraftTree.module.css'

const FINISH_ID = 'draft-finish'

const isText = (kind: string) => kind === 'narrative' || kind === 'bullet'

type Texts = Map<number, ClaudeText>
type Source = 'original' | 'library' | 'claude'

const BADGES: Record<Source, string> = { original: 'Original', library: 'Library', claude: 'Claude' }

// What the document Claude started from holds, to tell its items from ones Claude brought in.
interface Start {
  sections: Set<number>
  entries: Set<string>
  bullets: Set<number>
  skills: Set<number>
}

function startOf(sections: TreeSection[]): Start {
  const entries = sections.flatMap((section) => section.entries)
  return {
    sections: new Set(sections.map((section) => section.section_id)),
    entries: new Set(entries.map((entry) => keyOf(entry.kind, entry.item_id))),
    bullets: new Set([
      ...entries.filter((entry) => entry.kind === 'bullet').map((entry) => entry.item_id),
      ...entries.flatMap((entry) => entry.bullets.map((bullet) => bullet.item_id)),
    ]),
    skills: new Set(entries.flatMap((entry) => entry.skills.map((skill) => skill.item_id))),
  }
}

// Claude's text for a row, when it has one.
const claudeText = (texts: Texts, row: { text_key?: number | null }) =>
  row.text_key != null ? texts.get(row.text_key) : undefined

// Where a row's item or wording comes from: Claude's text (unless it went back to the
// original), or a saved item that's in the starting document or not.
function sourceOf(texts: Texts, row: { text_key?: number | null; use_original?: boolean }, inStart: boolean): Source {
  if (claudeText(texts, row) && !row.use_original) return 'claude'
  return inStart ? 'original' : 'library'
}

// "Source:" is for screen readers, so the badge makes sense heard after the row's name.
function Badge({ source }: { source: Source }) {
  return (
    <span className={`badge badge-${source}`}>
      <span className="visually-hidden">Source: </span>
      {BADGES[source]}
    </span>
  )
}

// What the switch in a rationale says: its label for the other wording and its button.
interface Words {
  original: string
  useOriginal: string
  useClaude: string
}

// Claude's reason, then for a rewording, the wording not in use and a button to switch to it.
// One button whose text changes, so it keeps focus.
function Rationale({
  name,
  reason,
  claude,
  original,
  useOriginal,
  onSwitch,
  words,
}: {
  // The row's name and where it is, for the toggle and the button.
  name: string
  reason?: string
  claude?: Pick<ClaudeText, 'text'>
  // The saved item's own wording, when Claude reworded one.
  original?: string
  useOriginal?: boolean
  onSwitch?: (useOriginal: boolean) => void
  // In place of a rewording's: the button names say what they switch on their own.
  words?: Words
}) {
  const reworded = claude !== undefined && original !== undefined && onSwitch !== undefined
  if (!reason && !reworded) return null
  const useOriginalName = words?.useOriginal ?? `Use the original wording of ${name}`
  const useClaudeName = words?.useClaude ?? `Use Claude's wording of ${name}`
  return (
    <Disclosure
      title={
        <>
          Rationale <span className="visually-hidden">for {name}</span>
        </>
      }
    >
      {reason && <p>{reason}</p>}
      {reworded && (
        <>
          <p className={styles.label}>{useOriginal ? "Claude's suggestion" : (words?.original ?? 'Original')}</p>
          <p>{useOriginal ? claude.text : original}</p>
          <button
            type="button"
            aria-label={words ? undefined : useOriginal ? useClaudeName : useOriginalName}
            onClick={() => onSwitch(!useOriginal)}
          >
            {words ? (useOriginal ? useClaudeName : useOriginalName) : useOriginal ? "Use Claude's wording" : 'Use the original'}
          </button>
        </>
      )}
    </Disclosure>
  )
}

// One row: its name, badge, and Reject for what Claude brought in or wrote, then the writing
// rules it breaks, its rationale, and what's under it.
function Row({
  name,
  label,
  source,
  flags,
  onReject,
  children,
}: {
  name: ReactNode
  // Its name and where it is, for the Reject button.
  label: string
  // Absent for what's neither Claude's nor the library's (a letter's usual greeting).
  source?: Source
  flags?: WritingFlag[]
  // Absent for what was already in the starting document, and for a rewording, which goes back
  // to the original instead.
  onReject?: () => void
  children?: ReactNode
}) {
  return (
    <li>
      <div className={styles.row}>
        <span>{name}</span>
        {source && <Badge source={source} />}
        {flags && flags.length > 0 && <span className="badge badge-flagged">Flagged</span>}
        {onReject && (
          <button type="button" aria-label={`Reject ${label}`} onClick={onReject}>
            Reject
          </button>
        )}
      </div>
      <Flags flags={flags} name={label} />
      {children}
    </li>
  )
}

export default function DraftTree({
  kind,
  draft,
  ownSections,
  toneName = null,
  onChange,
  onCheck,
  onFinish,
}: {
  kind: DocKind
  draft: Draft
  // The document's own tree: what Claude started from when it was read from the user's own file
  // (the draft names no other document then).
  ownSections: TreeSection[]
  // The document's tone, which the writing check checks too.
  toneName?: string | null
  // Saves the draft's new tree.
  onChange: (sections: DraftSection[]) => Promise<void>
  // Checks the draft against the writing rules again (only offered when that failed).
  onCheck: () => Promise<void>
  // `keep`: the keys of Claude's unused texts to keep in the library.
  onFinish: (keep: number[]) => Promise<void>
}) {
  const { path, singular } = KINDS[kind]
  const [library, setLibrary] = useState<Library | null>(null)
  const [start, setStart] = useState<Start | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [changeError, setChangeError] = useState<ApiError | null>(null)
  const [asking, setAsking] = useState(false)
  const [keep, setKeep] = useState<number[]>([])
  const [finishError, setFinishError] = useState<ApiError | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<ApiError | null>(null)
  const focusLater = useFocusLater()
  const idBase = useId()
  const texts: Texts = new Map(draft.texts.map((text) => [text.key, text]))
  const startingId = draft.starting_document?.id ?? null

  const load = useCallback(async () => {
    try {
      const startTree = async () => {
        if (startingId === null) return ownSections
        try {
          return (await docsApi(kind).get(startingId)).sections
        } catch (error) {
          // Deleted since: nothing to tell its items apart by.
          if (toApiError(error).code === 'NOT_FOUND') return []
          throw error
        }
      }
      const [loaded, tree] = await Promise.all([loadLibrary(), startTree()])
      setLibrary(loaded)
      setStart(startOf(tree))
      setLoadError(null)
    } catch (error) {
      setLoadError(toApiError(error))
    }
  }, [kind, startingId, ownSections])

  useEffect(() => {
    void load()
  }, [load])

  if (loadError) {
    return (
      <div role="alert">
        <p>{loadError.message}</p>
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }
  if (!library || !start) return <p>Loading your library…</p>

  // Claude's new sections have no id until they're kept, so they're told apart by key.
  const sectionKey = (section: DraftSection) => section.section_id ?? `new-${section.new_key}`
  const titleOf = (section: DraftSection) =>
    (section.section_id === null
      ? draft.new_sections?.find((row) => row.key === section.new_key)?.title
      : library.sections.find((row) => row.id === section.section_id)?.title) ?? ''
  const savedName = (entryKind: DraftEntry['kind'], itemId: number | null) =>
    itemId === null ? '' : (savedItems(library, entryKind).find((item) => item.id === itemId)?.name ?? '')
  const bulletText = (id: number | null) => library.bullets.find((bullet) => bullet.bullet_id === id)?.content ?? ''
  // The writing rules the wording in use breaks: Claude's, or the saved item's own.
  const itemFlags = (itemKind: string, itemId: number | null) =>
    draft.item_flags?.find((row) => row.kind === itemKind && row.item_id === itemId)?.flags
  const flagsOf = (itemKind: string, row: { item_id?: number | null; text_key?: number | null; use_original?: boolean }, itemId: number | null) => {
    const claude = claudeText(texts, row)
    return claude && !row.use_original ? claude.flags : itemFlags(itemKind, itemId)
  }
  const switched = (useOriginal: boolean, flags?: WritingFlag[]) =>
    (useOriginal ? 'Using the original wording.' : "Using Claude's wording.") + flagCount(flags)
  const unused = draft.texts.filter((text) => !textsInUse(draft.sections).has(text.key))
  const listId = (key: string) => `${idBase}-${key}`

  // Saves the new tree and announces it; after a rejection, focus goes to the list it was in, or
  // once that's empty and gone, the list above it.
  async function change(sections: DraftSection[], said: string, focusId?: string) {
    setChangeError(null)
    try {
      await onChange(sections)
      setAnnouncement(said)
      if (focusId) focusLater(focusId)
    } catch (error) {
      setChangeError(toApiError(error))
    }
  }

  const withSection = (section: DraftSection, next: DraftSection | null) =>
    next === null
      ? draft.sections.filter((row) => row !== section)
      : draft.sections.map((row) => (row === section ? next : row))

  function renderSkills(section: DraftSection, entry: DraftEntry, name: string, where: string) {
    // Claude can put any of the account's skills under a category or project, not only the ones
    // it lists, so a name comes from every list (every skill has a category).
    const listed = [...library!.categories, ...library!.projects].flatMap((item) => item.skills)
    const skillIds = entry.skill_ids ?? []
    if (skillIds.length === 0) return null
    const id = listId(`skills-${entry.kind}-${entry.item_id}`)
    // Once the last one is rejected, the list is gone, so focus goes to the section's items.
    const after = skillIds.length > 1 ? id : listId(`section-${sectionKey(section)}`)
    return (
      <ul id={id} tabIndex={-1} aria-label={`Skills under ${name} ${where}`} className={styles.children}>
        {skillIds.map((skillId) => {
          const skillName = listed.find((skill) => skill.skill_id === skillId)?.skill_name ?? ''
          const inStart = start!.skills.has(skillId)
          const reject = () =>
            void change(
              withSection(section, {
                ...section,
                entries: section.entries.map((row) =>
                  row === entry ? { ...entry, skill_ids: skillIds.filter((other) => other !== skillId) } : row,
                ),
              }),
              `Rejected ${skillName}.`,
              after,
            )
          return (
            <Row
              key={skillId}
              name={skillName}
              label={`${skillName} under ${name} ${where}`}
              source={inStart ? 'original' : 'library'}
              onReject={inStart ? undefined : reject}
            />
          )
        })}
      </ul>
    )
  }

  function renderBullets(section: DraftSection, entry: DraftEntry, name: string, where: string) {
    const bullets = entry.bullets ?? []
    if (bullets.length === 0) return null
    const id = listId(`bullets-${entry.kind}-${entry.item_id}`)
    const after = bullets.length > 1 ? id : listId(`section-${sectionKey(section)}`)
    const withBullets = (next: DraftBullet[]) =>
      withSection(section, {
        ...section,
        entries: section.entries.map((row) => (row === entry ? { ...entry, bullets: next } : row)),
      })
    return (
      <ul id={id} tabIndex={-1} aria-label={`Bullets under ${name} ${where}`} className={styles.children}>
        {bullets.map((bullet) => {
          const claude = claudeText(texts, bullet)
          const original = bulletText(bullet.bullet_id)
          const text = claude && !bullet.use_original ? claude.text : original
          const label = `"${shortBullet(text)}" under ${name} ${where}`
          const source = sourceOf(texts, bullet, bullet.bullet_id !== null && start!.bullets.has(bullet.bullet_id))
          const isNew = bullet.bullet_id === null
          const canReject = isNew || (source === 'library' && !claude)
          return (
            <Row
              key={isNew ? `new:${bullet.text_key}` : bullet.bullet_id}
              name={text}
              label={label}
              source={source}
              flags={flagsOf('bullet', bullet, bullet.bullet_id)}
              onReject={
                canReject
                  ? () => void change(withBullets(bullets.filter((row) => row !== bullet)), `Rejected "${shortBullet(text)}".`, after)
                  : undefined
              }
            >
              <Rationale
                name={label}
                reason={bullet.reason}
                claude={claude}
                original={isNew ? undefined : original}
                useOriginal={bullet.use_original}
                onSwitch={(useOriginal) =>
                  void change(
                    withBullets(bullets.map((row) => (row === bullet ? { ...row, use_original: useOriginal } : row))),
                    switched(useOriginal, flagsOf('bullet', { ...bullet, use_original: useOriginal }, bullet.bullet_id)),
                  )
                }
              />
            </Row>
          )
        })}
      </ul>
    )
  }

  function renderEntries(section: DraftSection, title: string) {
    const where = `in ${title}`
    const id = listId(`section-${sectionKey(section)}`)
    if (section.entries.length === 0) return <p className="muted">Nothing here.</p>
    const after = section.entries.length > 1 ? id : listId('sections')
    return (
      <ul id={id} tabIndex={-1} aria-label={`Items in ${title}`} className={styles.entries}>
        {section.entries.map((entry) => {
          const claude = claudeText(texts, entry)
          const saved = savedName(entry.kind, entry.item_id)
          const name = isText(entry.kind) && claude && !entry.use_original ? claude.text : saved
          const short = isText(entry.kind) ? `"${shortBullet(name)}"` : name
          const label = `${KIND_NAMES[entry.kind].one}: ${short} ${where}`
          const isNew = entry.item_id === null
          const source = sourceOf(texts, entry, !isNew && start!.entries.has(keyOf(entry.kind, entry.item_id!)))
          const canReject = isNew || (source === 'library' && !claude)
          return (
            <Row
              key={isNew ? `new:${entry.text_key}` : keyOf(entry.kind, entry.item_id!)}
              name={
                <>
                  <span className="muted">{KIND_NAMES[entry.kind].one}:</span> {name}
                </>
              }
              label={label}
              source={source}
              flags={isText(entry.kind) ? flagsOf(entry.kind, entry, entry.item_id) : undefined}
              onReject={
                canReject
                  ? () =>
                      void change(
                        withSection(section, { ...section, entries: section.entries.filter((row) => row !== entry) }),
                        `Rejected ${KIND_NAMES[entry.kind].one}: ${short}.`,
                        after,
                      )
                  : undefined
              }
            >
              <Rationale
                name={label}
                reason={entry.reason}
                claude={isText(entry.kind) ? claude : undefined}
                original={isText(entry.kind) && !isNew ? saved : undefined}
                useOriginal={entry.use_original}
                onSwitch={(useOriginal) =>
                  void change(
                    withSection(section, {
                      ...section,
                      entries: section.entries.map((row) => (row === entry ? { ...entry, use_original: useOriginal } : row)),
                    }),
                    switched(useOriginal, flagsOf(entry.kind, { ...entry, use_original: useOriginal }, entry.item_id)),
                  )
                }
              />
              {(entry.kind === 'category' || entry.kind === 'project') && renderSkills(section, entry, short, where)}
              {(entry.kind === 'experience' || entry.kind === 'project') && renderBullets(section, entry, short, where)}
            </Row>
          )
        })}
      </ul>
    )
  }

  // The button is gone once the check works, so focus goes to the sections.
  async function check() {
    if (checking) return
    setChecking(true)
    setCheckError(null)
    try {
      await onCheck()
      focusLater(sectionsId)
    } catch (error) {
      setCheckError(toApiError(error))
    } finally {
      setChecking(false)
    }
  }

  async function finish(kept: number[]) {
    if (finishing) return
    setFinishing(true)
    setFinishError(null)
    try {
      await onFinish(kept)
    } catch (error) {
      setFinishError(toApiError(error))
      setFinishing(false)
    }
  }

  function closeAsking() {
    setAsking(false)
    focusLater(FINISH_ID)
  }

  function startFinish() {
    if (unused.length === 0) {
      void finish([])
      return
    }
    setKeep([])
    setFinishError(null)
    setAsking(true)
  }

  const sectionsId = listId('sections')

  return (
    <>
      <p>
        {draft.starting_document ? (
          <>
            Claude started from <Link to={`${path}/${draft.starting_document.id}`}>{draft.starting_document.name}</Link>.{' '}
          </>
        ) : startingId === null && ownSections.length > 0 ? (
          `Claude started from your ${singular}. `
        ) : (
          'Claude started from your library. '
        )}
        {draft.starting_reason}
      </p>
      {draft.checked === false && (
        <div role="group" aria-labelledby={listId('unchecked')}>
          <p id={listId('unchecked')}>Claude couldn&apos;t check this draft against your writing rules, so nothing in it is flagged.</p>
          <p className="muted" id={listId('check-note')}>
            Checks Claude&apos;s wording and your library text in this draft for the banned words and patterns in your{' '}
            <Link to="/library/writing-rules">writing rules</Link>
            {toneName ? ` and the "${toneName}" tone` : ''}. Claude may reword its own text to fix what it finds; yours is only flagged.
          </p>
          {checkError && <p role="alert">{checkError.message}</p>}
          {/* aria-disabled, not disabled, so the button keeps focus while checking. */}
          <button type="button" aria-describedby={listId('check-note')} aria-disabled={checking} onClick={() => void check()}>
            {checking ? 'Checking…' : 'Check writing rules again'}
          </button>
        </div>
      )}
      {draft.sections.length === 0 ? (
        <p className="muted">No sections in the draft.</p>
      ) : (
        <ul id={sectionsId} tabIndex={-1} aria-label="Sections" className={styles.sections}>
          {draft.sections.map((section) => {
            const title = titleOf(section)
            const isNew = section.section_id === null
            const inStart = !isNew && start.sections.has(section.section_id!)
            return (
              <Row
                key={sectionKey(section)}
                name={<strong>{title}</strong>}
                label={`section "${title}"`}
                source={isNew ? 'claude' : inStart ? 'original' : 'library'}
                onReject={
                  inStart
                    ? undefined
                    : () =>
                        void change(
                          withSection(section, null),
                          `Rejected section "${title}".`,
                          draft.sections.length > 1 ? sectionsId : FINISH_ID,
                        )
                }
              >
                <Rationale name={`section "${title}"`} reason={section.reason} />
                {renderEntries(section, title)}
              </Row>
            )
          })}
        </ul>
      )}
      {changeError && <p role="alert">{changeError.message}</p>}
      {/* A plain live region rather than role="status", so the page's notices stay in AlertDialog. */}
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
      <p className="muted">
        Approving saves what you kept to this {singular}, and Claude&apos;s wordings to your library, used in this{' '}
        {singular} only. It can&apos;t be undone.
      </p>
      {finishError && !asking && <p role="alert">{finishError.message}</p>}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="button" id={FINISH_ID} aria-disabled={finishing} onClick={startFinish}>
          {finishing && !asking ? 'Approving…' : 'Approve first draft'}
        </button>
      </div>
      {asking && (
        <Dialog title="Claude's text you didn't use" onClose={closeAsking}>
          <form
            className="stacked-form"
            onSubmit={(event) => {
              event.preventDefault()
              void finish(keep)
            }}
          >
            <Checklist
              legend="Keep in your library for later"
              options={unused.map((text) => ({
                id: text.key,
                name: text.text,
                description: text.flags?.length ? <Flags flags={text.flags} name={`"${shortBullet(text.text)}"`} /> : undefined,
              }))}
              selected={keep}
              onChange={setKeep}
            />
            <p className="muted">The ones left unchecked are discarded.</p>
            {finishError && <p role="alert">{finishError.message}</p>}
            <div className="actions">
              <button type="submit" aria-disabled={finishing}>
                {finishing ? 'Approving…' : 'Approve first draft'}
              </button>
              <button type="button" onClick={closeAsking}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}

// The greeting Claude suggests for a cover letter, in the letter's Greeting level while there's a
// draft, with Claude's reason and a switch to the letter's usual greeting (and back). Approving
// the draft saves the one in use.
export function DraftGreeting({
  greeting,
  usual,
  onChange,
}: {
  greeting: Greeting
  // The letter's own addressee, which it keeps without Claude's.
  usual: string | null
  // Saves whether the draft uses the usual greeting.
  onChange: (useDefault: boolean) => Promise<void>
}) {
  const [announcement, setAnnouncement] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const said = (addressee: string | null) => (addressee ? `Dear ${addressee},` : 'No greeting.')

  async function choose(useDefault: boolean) {
    setError(null)
    try {
      await onChange(useDefault)
      setAnnouncement(useDefault ? 'Using the usual greeting.' : "Using Claude's greeting.")
    } catch (caught) {
      setError(toApiError(caught))
    }
  }

  return (
    <>
      <ul aria-label="Greeting" className={styles.sections}>
        <Row
          name={said(greeting.use_default ? usual : greeting.addressee)}
          label="greeting"
          source={greeting.use_default ? undefined : 'claude'}
        >
          <Rationale
            name="greeting"
            reason={greeting.reason}
            claude={{ text: said(greeting.addressee) }}
            original={said(usual)}
            useOriginal={greeting.use_default}
            onSwitch={(useDefault) => void choose(useDefault)}
            words={{ original: 'Usual greeting', useOriginal: 'Use the usual greeting', useClaude: "Use Claude's greeting" }}
          />
        </Row>
      </ul>
      {error && <p role="alert">{error.message}</p>}
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
    </>
  )
}
