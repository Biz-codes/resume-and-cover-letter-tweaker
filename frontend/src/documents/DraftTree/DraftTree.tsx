// The first pass over Claude's draft of a posting's resume or cover letter, in place of its tree
// until the review is finished (docs/APP_FLOW.md, "Tailoring a posting's document"). The same
// nested lists as DocumentTree, each row showing Claude's reason: sections, then each section's
// items, then a category's or project's skills and a role's or project's bullets. Each list can be
// reordered and taken from, and "More options" adds what the library lists there (that's how an
// item is swapped). Where Claude reworded narrative content or a bullet, its wording is used,
// with the original shown and a way back to it; Claude's new text is shown as new. An item added
// here comes with every skill it lists and no bullets.
//
// Each change saves the draft only (backend/app/drafts.py), so nothing reaches the document or the
// library until "Finish review", which first asks which of Claude's texts the draft doesn't use
// to keep in the library for later. Writing new content and View and Edit come back once the
// review is finished.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import {
  KINDS,
  textsInUse,
  type ClaudeText,
  type DocKind,
  type Draft,
  type DraftBullet,
  type DraftEntry,
  type DraftSection,
} from '../../shared/api/documents'
import Checklist from '../../shared/components/Checklist'
import Dialog from '../../shared/components/Dialog/Dialog'
import OrderedList, { type ListItem } from '../../shared/components/OrderedList/OrderedList'
import { useFocusLater } from '../../shared/hooks/useFocusLater'
import { offered } from '../../shared/offered'
import { entryItem, fromKey, KIND_NAMES, KINDS_IN_ORDER, listedIds, loadLibrary, savedItems, type Library } from '../treeItems'
import styles from '../DocumentTree/DocumentTree.module.css'

const FINISH_ID = 'draft-finish'

const isText = (kind: string) => kind === 'narrative' || kind === 'bullet'

// A row's key in its list: the item's, or for Claude's new text, its text's.
const entryKey = (entry: DraftEntry) =>
  entry.item_id === null ? `new:${entry.text_key}` : `${entry.kind}:${entry.item_id}`
const bulletKey = (bullet: DraftBullet) =>
  bullet.bullet_id === null ? `new:${bullet.text_key}` : `bullet:${bullet.bullet_id}`

type Texts = Map<number, ClaudeText>

// The wording a text row shows: Claude's, unless it went back to the original (`original`).
function wording(texts: Texts, row: { text_key?: number | null; use_original?: boolean }, original: string) {
  const claude = row.text_key != null ? texts.get(row.text_key) : undefined
  return claude && !row.use_original ? claude.text : original
}

// Claude's reason for a row, when it has one (what the user added has none).
function Reason({ reason }: { reason?: string }) {
  return reason ? <p className="muted">Claude: {reason}</p> : null
}

// Claude's wording of a row, with the original and a button to switch between them.
function Wording({
  texts,
  row,
  original,
  name,
  onSwitch,
}: {
  texts: Texts
  row: { item_id?: number | null; bullet_id?: number | null; text_key?: number | null; use_original?: boolean }
  original: string
  // The row's name and where it is, for the button.
  name: string
  onSwitch: (useOriginal: boolean) => Promise<void>
}) {
  const claude = row.text_key != null ? texts.get(row.text_key) : undefined
  if (!claude) return null
  if ((row.item_id ?? row.bullet_id) == null) return <p>New text from Claude.</p>
  return row.use_original ? (
    <>
      <p>Your original wording. Claude&apos;s: &ldquo;{claude.text}&rdquo;</p>
      <button type="button" aria-label={`Use Claude's wording of ${name}`} onClick={() => void onSwitch(false)}>
        Use Claude&apos;s wording
      </button>
    </>
  ) : (
    <>
      <p>Claude&apos;s wording. Original: &ldquo;{original}&rdquo;</p>
      <button type="button" aria-label={`Use the original wording of ${name}`} onClick={() => void onSwitch(true)}>
        Use the original
      </button>
    </>
  )
}

// What opens under one item: its reason, its wording, and its skills and bullets.
function EntryBody({
  entry,
  library,
  texts,
  name,
  rowLabel,
  where,
  taken,
  onChange,
}: {
  entry: DraftEntry
  library: Library
  texts: Texts
  // What it's called without its kind, which names its lists, and its row's label.
  name: string
  rowLabel: string
  // The section it's in, which names its rows' buttons.
  where: string
  // Bullets elsewhere in the section, which can't be added here too.
  taken: Set<number>
  onChange: (entry: DraftEntry, notice?: string) => Promise<void>
}) {
  const category = entry.kind === 'category' ? library.categories.find((item) => item.category_id === entry.item_id) : undefined
  const project = entry.kind === 'project' ? library.projects.find((item) => item.project_id === entry.item_id) : undefined
  const role = entry.kind === 'experience' ? library.experience.find((item) => item.experience_id === entry.item_id) : undefined
  const original = library.narrative.find((item) => item.content_id === entry.item_id)?.content ??
    library.bullets.find((item) => item.bullet_id === entry.item_id)?.content ??
    ''
  const switchEntry = (useOriginal: boolean) =>
    onChange({ ...entry, use_original: useOriginal }, useOriginal ? 'Using the original wording.' : "Using Claude's wording.")

  const listedSkills = category?.skills ?? project?.skills ?? []
  const skillName = (id: number) => listedSkills.find((skill) => skill.skill_id === id)?.skill_name ?? ''
  const skills = (entry.skill_ids ?? []).map((id) => ({ id, name: skillName(id) }))
  const skillChoices = offered(listedSkills).map((skill) => ({ id: skill.skill_id, name: skill.skill_name }))

  const listedBullets = role?.bullets ?? project?.bullets ?? []
  const hiddenBullets = new Set(library.bullets.filter((bullet) => bullet.hidden).map((bullet) => bullet.bullet_id))
  const bulletText = (id: number | null) => library.bullets.find((bullet) => bullet.bullet_id === id)?.content ?? ''
  const bullets = entry.bullets ?? []
  const bulletItems = bullets.map((bullet) => {
    const text = wording(texts, bullet, bulletText(bullet.bullet_id))
    return { id: bulletKey(bullet), name: text, label: `"${shortBullet(text)}"` }
  })
  const bulletChoices = listedBullets
    .filter((bullet) => !taken.has(bullet.bullet_id) && !hiddenBullets.has(bullet.bullet_id))
    .map((bullet) => ({ id: `bullet:${bullet.bullet_id}`, name: bullet.content, label: `"${shortBullet(bullet.content)}"` }))
  const bulletWhere = `under ${name} ${where}`

  return (
    <>
      <Reason reason={entry.reason} />
      {isText(entry.kind) && <Wording texts={texts} row={entry} original={original} name={`${rowLabel} ${where}`} onSwitch={switchEntry} />}
      {(entry.kind === 'category' || entry.kind === 'project') && (
        <>
          <p className={styles.listLabel}>Skills</p>
          <OrderedList
            label={`${name} skills`}
            where={bulletWhere}
            items={skills}
            choices={skillChoices}
            emptyText={`No skills shown with ${name}.`}
            moreOptions
            onChange={(ids) => onChange({ ...entry, skill_ids: ids })}
          />
        </>
      )}
      {(entry.kind === 'experience' || entry.kind === 'project') && (
        <>
          <p className={styles.listLabel}>Bullets</p>
          <OrderedList<string>
            label={`${name} bullets`}
            where={bulletWhere}
            items={bulletItems}
            choices={bulletChoices}
            emptyText={`No bullets shown with ${name}.`}
            moreOptions
            details={(item) => {
              const bullet = bullets.find((row) => bulletKey(row) === item.id)
              if (!bullet || (!bullet.reason && bullet.text_key == null)) return null
              const switchBullet = (useOriginal: boolean) =>
                onChange(
                  { ...entry, bullets: bullets.map((row) => (row === bullet ? { ...row, use_original: useOriginal } : row)) },
                  useOriginal ? 'Using the original wording.' : "Using Claude's wording.",
                )
              return (
                <>
                  <Reason reason={bullet.reason} />
                  <Wording
                    texts={texts}
                    row={bullet}
                    original={bulletText(bullet.bullet_id)}
                    name={`${item.label} ${bulletWhere}`}
                    onSwitch={switchBullet}
                  />
                </>
              )
            }}
            onChange={(keys) =>
              onChange({
                ...entry,
                bullets: keys.map(
                  (key) => bullets.find((row) => bulletKey(row) === key) ?? { bullet_id: fromKey(key).item_id },
                ),
              })
            }
          />
        </>
      )}
    </>
  )
}

// One section's items, each opening to what's under it.
function SectionBody({
  section,
  title,
  library,
  texts,
  onChange,
}: {
  section: DraftSection
  title: string
  library: Library
  texts: Texts
  onChange: (section: DraftSection, notice?: string) => Promise<void>
}) {
  const where = `in ${title}`
  const nameOf = (entry: DraftEntry) => {
    const saved = entry.item_id === null ? undefined : savedItems(library, entry.kind).find((item) => item.id === entry.item_id)
    return isText(entry.kind) ? wording(texts, entry, saved?.name ?? '') : (saved?.name ?? '')
  }
  const items = section.entries.map((entry) => {
    const name = nameOf(entry)
    return { ...entryItem(entry.kind, 0, name, isText(entry.kind) ? `"${shortBullet(name)}"` : name), id: entryKey(entry) }
  })
  const entryOf = (key: string) => section.entries.find((entry) => entryKey(entry) === key)
  // Every bullet in the section, directly or under an item.
  const bulletsHere = (except?: DraftEntry) =>
    new Set(
      section.entries
        .filter((entry) => entry !== except)
        .flatMap((entry) => [
          ...(entry.kind === 'bullet' && entry.item_id !== null ? [entry.item_id] : []),
          ...(entry.bullets ?? []).flatMap((bullet) => (bullet.bullet_id === null ? [] : [bullet.bullet_id])),
        ]),
    )
  const taken = bulletsHere()
  // What the library lists under the section, by type, for "More options".
  const choices = KINDS_IN_ORDER.flatMap((itemKind) => {
    const listed = new Set(listedIds(library, section.section_id, itemKind))
    return savedItems(library, itemKind)
      .filter((item) => listed.has(item.id) && !(itemKind === 'bullet' && taken.has(item.id)))
      .map((item) => ({ ...entryItem(itemKind, item.id, item.name), group: KIND_NAMES[itemKind].type }))
  })
  // An item added here comes with every skill it lists, and no bullets.
  function added(key: string): DraftEntry {
    const { kind, item_id } = fromKey(key)
    const skills =
      kind === 'category'
        ? library.categories.find((item) => item.category_id === item_id)?.skills
        : kind === 'project'
          ? library.projects.find((item) => item.project_id === item_id)?.skills
          : undefined
    return { kind, item_id, skill_ids: offered(skills ?? []).map((skill) => skill.skill_id), bullets: [] }
  }

  return (
    <>
      <Reason reason={section.reason} />
      <OrderedList<string>
        label={`Items in ${title}`}
        where={where}
        items={items}
        choices={choices}
        emptyText="Nothing here yet."
        moreOptions
        moreOpen={items.length === 0}
        details={(item: ListItem<string>) => {
          const entry = entryOf(item.id)
          if (!entry) return null
          if (isText(entry.kind) && !entry.reason && entry.text_key == null) return null
          return (
            <EntryBody
              entry={entry}
              library={library}
              texts={texts}
              name={item.name.replace(/^[^:]*: /, '')}
              rowLabel={item.label ?? item.name}
              where={where}
              taken={bulletsHere(entry)}
              onChange={(next, notice) =>
                onChange({ ...section, entries: section.entries.map((row) => (row === entry ? next : row)) }, notice)
              }
            />
          )
        }}
        onChange={(keys) => onChange({ ...section, entries: keys.map((key) => entryOf(key) ?? added(key)) })}
      />
    </>
  )
}

export default function DraftTree({
  kind,
  draft,
  onChange,
  onFinish,
}: {
  kind: DocKind
  draft: Draft
  // Saves the draft's new tree, with a notice for what the lists don't announce themselves.
  onChange: (sections: DraftSection[], notice?: string) => Promise<void>
  // `keep`: the keys of Claude's unused texts to keep in the library.
  onFinish: (keep: number[]) => Promise<void>
}) {
  const { path, singular } = KINDS[kind]
  const [library, setLibrary] = useState<Library | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [asking, setAsking] = useState(false)
  const [keep, setKeep] = useState<number[]>([])
  const [finishError, setFinishError] = useState<ApiError | null>(null)
  const [finishing, setFinishing] = useState(false)
  const focusLater = useFocusLater()
  const texts: Texts = new Map(draft.texts.map((text) => [text.key, text]))

  const load = useCallback(
    () =>
      loadLibrary()
        .then((loaded) => {
          setLibrary(loaded)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

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
  if (!library) return <p>Loading your library…</p>

  const titleOf = (sectionId: number) => library.sections.find((section) => section.id === sectionId)?.title ?? ''
  const unused = draft.texts.filter((text) => !textsInUse(draft.sections).has(text.key))

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

  return (
    <>
      <p>
        {draft.starting_document ? (
          <>
            Claude started from <Link to={`${path}/${draft.starting_document.id}`}>{draft.starting_document.name}</Link>.{' '}
          </>
        ) : (
          'Claude started from your library. '
        )}
        {draft.starting_reason}
      </p>
      <OrderedList
        label="Sections"
        items={draft.sections.map((section) => ({ id: section.section_id, name: titleOf(section.section_id) }))}
        choices={offered(library.sections).map((section) => ({ id: section.id, name: section.title }))}
        emptyText="No sections in the draft."
        moreOptions
        details={(item) => {
          const section = draft.sections.find((row) => row.section_id === item.id)
          return section ? (
            <SectionBody
              section={section}
              title={item.name}
              library={library}
              texts={texts}
              onChange={(next, notice) =>
                onChange(
                  draft.sections.map((row) => (row === section ? next : row)),
                  notice,
                )
              }
            />
          ) : null
        }}
        onChange={(ids) =>
          onChange(ids.map((id) => draft.sections.find((section) => section.section_id === id) ?? { section_id: id, entries: [] }))
        }
      />
      <p className="muted">
        Finishing saves what you kept to this {singular}, and Claude&apos;s wordings to your library, used in this {singular}{' '}
        only. It can&apos;t be undone.
      </p>
      {finishError && !asking && <p role="alert">{finishError.message}</p>}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="button" id={FINISH_ID} aria-disabled={finishing} onClick={startFinish}>
          {finishing && !asking ? 'Finishing…' : 'Finish review'}
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
              options={unused.map((text) => ({ id: text.key, name: text.text }))}
              selected={keep}
              onChange={setKeep}
            />
            <p className="muted">The ones left unchecked are discarded.</p>
            {finishError && <p role="alert">{finishError.message}</p>}
            <div className="actions">
              <button type="submit" aria-disabled={finishing}>
                {finishing ? 'Finishing…' : 'Finish review'}
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
