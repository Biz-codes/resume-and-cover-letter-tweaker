// A resume's or cover letter's sections, as nested lists whose levels open and close: each
// section opens to the items placed in it (any mix of kinds, in one order), and a role, project,
// or education entry opens to its fields, a category or project to its skills, and a role or
// project to its bullets. Each level can be reordered and taken from. Each list starts with its
// defaults (the backend's app/defaults.py, chosen when a section or item is added), and under it,
// "More options" offers the rest of what the library lists there to check and add together (a
// section's items come with their own defaults). Anything else goes in a section type first
// (AddContent), from the library or written new; bullets and skills can be written in place too.
// Each row's View and Edit opens its library item in the same dialog as the library's
// (useItemDialogs), where an edit changes it in this document, and in the others in progress the
// user checks (docs/FRONTEND_CHECKS.md, "Changing an item"). Each change is saved right away and
// returns the document with its new output.
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { docsApi, KINDS, type DocDetail, type DocKind, type EntryKind, type TreeEntry, type TreeSection } from '../../shared/api/documents'
import { useFocusLater } from '../../shared/hooks/useFocusLater'
import AddContent from '../AddContent'
import Disclosure from '../../shared/components/Disclosure/Disclosure'
import NameForm from '../../shared/components/NameForm/NameForm'
import OrderedList, { type ListItem } from '../../shared/components/OrderedList/OrderedList'
import { useItemDialogs } from '../../library/items/ItemDialogs'
import type { ItemRef } from '../../library/items/itemHost'
import {
  entryItem,
  fromKey,
  itemName,
  KIND_NAMES,
  KINDS_IN_ORDER,
  listedIds,
  loadLibrary,
  placedItem,
  savedItems,
  SHOWN_FIELDS,
  type Library,
} from '../treeItems'
import styles from './DocumentTree.module.css'
import { offered } from '../../shared/offered'

// A button for each thing that can be written here, each opening its own form. Focus moves into
// the form, and back to its button when it closes.
interface WriteOption {
  key: string
  button: string
  // The button's full name, starting with its text (what it writes, and for what).
  buttonLabel: string
  // The field's label, and the request field a refusal names.
  field: string
  name: string
  // A textarea, for text longer than a name.
  multiline: boolean
  submit: string
}

function Writer({
  idBase,
  options,
  onWrite,
}: {
  // Makes the buttons' ids unique on the page.
  idBase: string
  options: WriteOption[]
  onWrite: (key: string, content: string) => Promise<void>
}) {
  const [writing, setWriting] = useState<WriteOption | null>(null)
  const focusLater = useFocusLater()
  const buttonId = (option: WriteOption) => `write-${option.key}-${idBase}`

  function close(option: WriteOption) {
    setWriting(null)
    focusLater(buttonId(option))
  }

  if (writing) {
    return (
      <NameForm
        label={writing.field}
        field={writing.name}
        submitLabel={writing.submit}
        multiline={writing.multiline}
        onSave={async (content) => {
          await onWrite(writing.key, content)
          close(writing)
        }}
        onCancel={() => close(writing)}
      />
    )
  }
  return (
    <div className="actions">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          id={buttonId(option)}
          aria-label={option.buttonLabel}
          onClick={() => setWriting(option)}
        >
          {option.button}
        </button>
      ))}
    </div>
  )
}

// A row's View and Edit button: `row` makes its id unique on the page, `label` names the row and
// where it is (an item can be in more than one section, a skill under more than one category),
// and `ref` is its library item.
type EditRow = (row: string, label: string, ref: ItemRef) => ReactNode

// What opens under a role, project, or education entry (its fields, as the library has them),
// and a category's or project's skills and a role's or project's bullets here.
function EntryChildren({
  entry,
  library,
  onSkills,
  onBullets,
  taken,
  onWriteBullet,
  onWriteSkill,
  editRow,
  sectionTitle,
}: {
  entry: TreeEntry
  // Null when read-only: nothing to add from.
  library: Library | null
  // Bullets elsewhere in the section, which can't be added here too (each goes in a section once).
  taken: Set<number>
  onSkills: (ids: number[]) => Promise<void>
  onBullets: (ids: number[]) => Promise<void>
  // A new bullet.
  onWriteBullet: (content: string) => Promise<void>
  onWriteSkill: (skillName: string) => Promise<void>
  editRow: EditRow
  // The section it's placed in, which names its rows' buttons.
  sectionTitle: string
}) {
  const name = placedItem(entry).name.replace(/^[^:]*: /, '')
  const readOnly = library === null
  const category =
    entry.kind === 'category' ? library?.categories.find((item) => item.category_id === entry.item_id) : undefined
  const project = entry.kind === 'project' ? library?.projects.find((item) => item.project_id === entry.item_id) : undefined
  const role =
    entry.kind === 'experience' ? library?.experience.find((item) => item.experience_id === entry.item_id) : undefined
  // Hidden skills and bullets aren't offered (docs/FRONTEND_CHECKS.md, "Hiding").
  const hiddenBullets = new Set(library?.bullets.filter((bullet) => bullet.hidden).map((bullet) => bullet.bullet_id))
  const listedSkills = offered(category?.skills ?? project?.skills ?? [])
  // A category or project can show any skill in the library, since skill sets overlap: the ones
  // it doesn't list yet come after its own, and adding one lists it there too
  // (docs/FRONTEND_CHECKS.md, "Skills in a category" and "Skills in a project"). Every skill is
  // in a category, so the categories hold them all.
  const listedIds = new Set(listedSkills.map((skill) => skill.skill_id))
  const otherSkills = category || project
    ? [...new Map(offered(library?.categories.flatMap((item) => item.skills) ?? []).map((skill) => [skill.skill_id, skill])).values()].filter(
        (skill) => !listedIds.has(skill.skill_id),
      )
    : []
  const skillChoices = [
    ...listedSkills.map((skill) => ({
      id: skill.skill_id,
      name: skill.skill_name,
      group: otherSkills.length > 0 ? `Listed under ${name}` : undefined,
    })),
    ...otherSkills.map((skill) => ({
      id: skill.skill_id,
      name: skill.skill_name,
      group: `Other skills in your library (adding one lists it under ${name} too)`,
    })),
  ]
  const bulletChoices = (role?.bullets ?? project?.bullets ?? [])
    .filter((bullet) => !taken.has(bullet.bullet_id) && !hiddenBullets.has(bullet.bullet_id))
    .map((bullet) => ({
    id: bullet.bullet_id,
    name: bullet.content,
    label: `"${shortBullet(bullet.content)}"`,
  }))
  const bullets = entry.bullets.map((bullet) => ({
    id: bullet.item_id,
    name: bullet.text,
    label: `"${shortBullet(bullet.text)}"`,
  }))

  const skills = entry.skills.map((skill) => ({ id: skill.item_id, name: skill.text }))

  const parentKind = entry.kind === 'project' ? 'project' : entry.kind === 'category' ? 'category' : 'experience'
  const bulletActions = (item: ListItem<number>) => {
    const row = entry.bullets.find((bullet) => bullet.item_id === item.id)
    return (
      row &&
      editRow(
        `bullet-${parentKind}-${row.row_id}`,
        `${item.label ?? item.name} under ${name} in ${sectionTitle}`,
        { kind: 'bullet', id: row.item_id, title: shortBullet(row.text) },
      )
    )
  }
  const skillActions = (item: ListItem<number>) => {
    const row = entry.skills.find((skill) => skill.item_id === item.id)
    return (
      row &&
      editRow(
        `skill-${parentKind}-${row.row_id}`,
        `${item.name} under ${name} in ${sectionTitle}`,
        { kind: 'skill', id: row.item_id, title: row.text },
      )
    )
  }

  const shownFields = SHOWN_FIELDS[entry.kind]
  // Each part of the item: its fields, its skills, its bullets. An item with more than one (a role
  // or project) shows each as a level that opens and closes, named for the item so screen readers
  // can tell one item's "Bullets" from another's; one with a single part shows it as it is.
  const parts: { key: string; title: string; count?: number; content: ReactNode }[] = []
  if (shownFields) {
    parts.push({
      key: 'details',
      title: 'Details',
      content: (
        <dl className="details-list">
          {shownFields.map((field) => (
            <Fragment key={field.name}>
              <dt>{field.label}</dt>
              <dd>{entry.values[field.name] || 'None'}</dd>
            </Fragment>
          ))}
        </dl>
      ),
    })
  }
  if (entry.kind === 'category' || entry.kind === 'project') {
    parts.push({
      key: 'skills',
      title: 'Skills',
      count: entry.skills.length,
      content: (
        <>
          <OrderedList
            label={`${name} skills`}
            where={`under ${name} in ${sectionTitle}`}
            items={skills}
            choices={skillChoices}
            emptyText={`No skills shown with ${name} yet.`}
            readOnly={readOnly}
            moreOptions
            actions={readOnly ? undefined : skillActions}
            onChange={onSkills}
          />
          {!readOnly && (
            <Writer
              idBase={`${entry.kind}-${entry.row_id}-skill`}
              options={[
                {
                  key: 'skill',
                  button: 'New skill',
                  buttonLabel: `New skill for ${name}`,
                  field: `New skill for ${name}`,
                  name: 'skill_name',
                  multiline: false,
                  submit: 'Add skill',
                },
              ]}
              onWrite={(_, skillName) => onWriteSkill(skillName)}
            />
          )}
        </>
      ),
    })
  }
  if (entry.kind === 'experience' || entry.kind === 'project') {
    parts.push({
      key: 'bullets',
      title: 'Bullets',
      count: entry.bullets.length,
      content: (
        <>
          <OrderedList
            label={`${name} bullets`}
            where={`under ${name} in ${sectionTitle}`}
            items={bullets}
            choices={bulletChoices}
            emptyText={`No bullets shown with ${name} yet.`}
            readOnly={readOnly}
            moreOptions
            actions={readOnly ? undefined : bulletActions}
            onChange={onBullets}
          />
          {!readOnly && (
            <Writer
              idBase={`${entry.kind}-${entry.row_id}`}
              options={[
                {
                  key: 'bullet',
                  button: 'New bullet',
                  buttonLabel: `New bullet for ${name}`,
                  field: `New bullet for ${name}`,
                  name: 'content',
                  multiline: true,
                  submit: 'Add bullet',
                },
              ]}
              onWrite={(_, content) => onWriteBullet(content)}
            />
          )}
        </>
      ),
    })
  }

  if (parts.length === 1) {
    const [part] = parts
    return (
      <>
        {part.key !== 'details' && <p className={styles.listLabel}>{part.title}</p>}
        {part.content}
      </>
    )
  }
  return (
    <ul className={styles.parts}>
      {parts.map((part) => (
        <li key={part.key}>
          <Disclosure
            title={
              <>
                {part.title} <span className="visually-hidden">for {name}</span>
                {part.count !== undefined && ` (${part.count})`}
              </>
            }
          >
            {part.content}
          </Disclosure>
        </li>
      ))}
    </ul>
  )
}

// Narrative content and bullets are their text; every other kind opens to more.
const opens = (kind: EntryKind) => kind !== 'narrative' && kind !== 'bullet'

// What opens under one of the document's sections: the items placed in it, each opening to
// what's under it, then adding more.
function SectionBody({
  kind,
  doc,
  section,
  library,
  saved,
  written,
  reloadLibrary,
  onNotice,
  editRow,
}: {
  kind: DocKind
  doc: DocDetail
  section: TreeSection
  // Null when read-only.
  library: Library | null
  saved: (request: Promise<DocDetail>) => Promise<void>
  // Without a notice, the caller gives its own.
  written: (request: Promise<DocDetail>, notice: string) => Promise<void>
  // Reads the library again, after a change that adds to its lists.
  reloadLibrary: () => void
  onNotice: (notice: string) => void
  editRow: EditRow
}) {
  const api = docsApi(kind)
  const readOnly = library === null
  const items = section.entries.map(placedItem)
  const entryOf = (item: ListItem<string>) => section.entries.find((placed) => placedItem(placed).id === item.id)
  // Every bullet in the section, directly or under an item.
  const bulletsHere = (except?: TreeEntry) =>
    new Set(
      section.entries
        .filter((entry) => entry !== except)
        .flatMap((entry) => [...(entry.kind === 'bullet' ? [entry.item_id] : []), ...entry.bullets.map((bullet) => bullet.item_id)]),
    )
  // What the library lists under the section, by type, for "More options". Bullets already in the
  // section are left out.
  const taken = bulletsHere()
  const choices = library
    ? KINDS_IN_ORDER.flatMap((itemKind) => {
        const listed = new Set(listedIds(library, section.section_id, itemKind))
        return savedItems(library, itemKind)
          .filter((item) => listed.has(item.id) && !(itemKind === 'bullet' && taken.has(item.id)))
          .map((item) => ({ ...entryItem(itemKind, item.id, item.name), group: KIND_NAMES[itemKind].type }))
      })
    : []
  const entryActions = (item: ListItem<string>) => {
    const entry = entryOf(item)
    if (!entry) return null
    const name = itemName(entry.kind, entry.values)
    return editRow(`${entry.kind}-${entry.row_id}`, `${item.label ?? item.name} in ${section.title}`, {
      kind: entry.kind,
      id: entry.item_id,
      title: opens(entry.kind) ? name : shortBullet(name),
    })
  }

  return (
    <>
      <OrderedList
        label={`Items in ${section.title}`}
        where={`in ${section.title}`}
        items={items}
        choices={choices}
        emptyText="Nothing here yet."
        readOnly={readOnly}
        moreOptions
        // An empty section opens it, to show the Add content form.
        moreOpen={items.length === 0}
        moreChildren={
          library && (
            <AddContent
              docKind={kind}
              section={section}
              library={library}
              onAdd={async (addKind, itemId) => {
                await saved(api.placeItems(doc.id, section.row_id, [{ kind: addKind, item_id: itemId }]))
                onNotice(`Added the ${KIND_NAMES[addKind].lower} to ${section.title}.`)
              }}
              onWrite={(item) =>
                written(
                  api.write(doc.id, section.row_id, item),
                  `Added the new ${KIND_NAMES[item.kind].lower}. It's saved in your library too.`,
                )
              }
            />
          )
        }
        // Each comes with its own defaults.
        onAdd={(keys) => saved(api.placeItems(doc.id, section.row_id, keys.map(fromKey)))}
        actions={readOnly ? undefined : entryActions}
        details={(item) => {
          const entry = entryOf(item)
          if (!entry || !opens(entry.kind)) return null
          const parent = entry.kind === 'project' ? 'project' : 'experience'
          return (
            <EntryChildren
              entry={entry}
              library={library}
              taken={bulletsHere(entry)}
              onSkills={async (ids) => {
                await saved(api.setSkills(doc.id, entry.kind === 'project' ? 'project' : 'category', entry.row_id, ids))
                // A skill the category or project didn't list is listed under it now, so the library
                // is read again.
                const listed =
                  (entry.kind === 'project'
                    ? library?.projects.find((item) => item.project_id === entry.item_id)?.skills
                    : library?.categories.find((item) => item.category_id === entry.item_id)?.skills) ?? []
                if (ids.some((id) => !listed.some((skill) => skill.skill_id === id))) reloadLibrary()
              }}
              onBullets={(ids) => saved(api.setBullets(doc.id, parent, entry.row_id, ids))}
              onWriteSkill={(skillName) =>
                written(
                  api.writeSkill(doc.id, entry.kind === 'project' ? 'project' : 'category', entry.row_id, skillName),
                  "Added the new skill. It's saved in your library too.",
                )
              }
              onWriteBullet={(content) =>
                written(api.writeBullet(doc.id, parent, entry.row_id, content), "Added the new bullet. It's saved in your library too.")
              }
              editRow={editRow}
              sectionTitle={section.title}
            />
          )
        }}
        onChange={(keys) => saved(api.setItems(doc.id, section.row_id, keys.map(fromKey)))}
      />
    </>
  )
}

export default function DocumentTree({
  kind,
  doc,
  readOnly,
  onChange,
  onReload,
  onNotice,
}: {
  kind: DocKind
  doc: DocDetail
  // Sent, or a base version before the user chose to edit it: only shown.
  readOnly: boolean
  // The document with its new tree and output, after each saved change.
  onChange: (doc: DocDetail) => void
  // The document read again after a change to the library from an item's dialog (a save, a hide,
  // a delete), which isn't a change to undo here.
  onReload: (doc: DocDetail) => void
  onNotice: (notice: string | null) => void
}) {
  const [library, setLibrary] = useState<Library | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const api = docsApi(kind)

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

  // The library is only needed for adding, so it's read once editing is allowed.
  useEffect(() => {
    if (!readOnly) void load()
  }, [load, readOnly])

  // Each change sends the whole list and gets the document back.
  const saved = async (request: Promise<DocDetail>) => onChange(await request)

  // Writing adds to the library too, so its lists are read again.
  async function written(request: Promise<DocDetail>, notice: string) {
    onChange(await request)
    onNotice(notice)
    void load()
  }

  // A library change from a dialog can change what this document shows (an unsent version
  // switches to a saved item's new row, a deleted item is taken out), so both are read again.
  const { open, dialog } = useItemDialogs({
    reload: () => Promise.all([api.get(doc.id).then(onReload), load()]),
    notify: onNotice,
  })

  const editRow: EditRow = (row, label, ref) => {
    const id = `edit-${row}`
    return (
      <button
        type="button"
        id={id}
        aria-label={`View and Edit ${label}`}
        onClick={() => open(ref, { doc: KINDS[kind].singular, where: { kind, id: doc.id }, returnTo: id })}
      >
        View and Edit
      </button>
    )
  }

  const sectionItems = doc.sections.map((section) => ({ id: section.section_id, name: section.title }))
  const sectionActions = (item: ListItem<number>) => {
    const section = doc.sections.find((placed) => placed.section_id === item.id)
    return (
      section &&
      editRow(
        `section-${section.row_id}`,
        section.title,
        { kind: 'section', id: section.section_id, title: section.title },
      )
    )
  }

  if (!readOnly && loadError) {
    return (
      <div role="alert">
        <p>{loadError.message}</p>
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }
  if (!readOnly && !library) return <p>Loading your library…</p>
  const shown = readOnly ? null : library

  return (
    <>
      <OrderedList
        label="Sections"
        items={sectionItems}
        choices={shown ? offered(shown.sections).map((section) => ({ id: section.id, name: section.title })) : []}
        emptyText={readOnly ? 'No sections.' : 'No sections yet. Add one to start.'}
        readOnly={readOnly}
        moreOptions
        moreChildren={
          <Writer
            idBase="sections"
            options={[
              {
                key: 'section',
                button: 'New section title',
                buttonLabel: 'New section title',
                field: 'New section title',
                name: 'title',
                multiline: false,
                submit: 'Add section',
              },
            ]}
            onWrite={(_, title) => written(api.writeSection(doc.id, title), `Added the new section "${title.trim()}".`)}
          />
        }
        actions={readOnly ? undefined : sectionActions}
        details={(item) => {
          const section = doc.sections.find((placed) => placed.section_id === item.id)
          return section ? (
            <SectionBody
              kind={kind}
              doc={doc}
              section={section}
              library={shown}
              saved={saved}
              written={written}
              reloadLibrary={() => void load()}
              onNotice={onNotice}
              editRow={editRow}
            />
          ) : null
        }}
        onChange={(ids) => saved(api.setSections(doc.id, ids))}
      />
      {!readOnly && (
        <p className="muted">Removing a section takes out everything placed in it here. The library keeps it all.</p>
      )}
      {dialog}
    </>
  )
}
