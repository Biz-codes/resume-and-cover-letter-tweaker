// A resume's or cover letter's sections, as nested lists whose levels open and close: each
// section opens to the items placed in it (any mix of kinds, in one order), and a role, project,
// or education entry opens to its fields, a category or project to its skills, and a role or
// project to its bullets. Each level can be reordered and taken from. Each list starts with its
// defaults (the backend's app/defaults.py, chosen when a section or item is added), and under it,
// "More options" offers the rest of what the library lists there to check and add together (a
// section's items come with their own defaults). Anything else goes in a section type first
// (AddContent), from the library or written new; bullets can be written in place too. Each bullet (and each narrative content
// placed in a section) can be rewritten as a new version, which takes its place here and leaves
// the original in the library. Each change is saved right away and returns the document with its
// new output.
import { Fragment, useCallback, useEffect, useState } from 'react'
import { bulletsApi, shortBullet } from '../api/bullets'
import { toApiError, type ApiError } from '../api/client'
import { docsApi, type DocDetail, type DocKind, type EntryKind, type TreeEntry, type TreeSection } from '../api/documents'
import { educationApi } from '../api/education'
import { experienceApi } from '../api/experience'
import { narrativeApi } from '../api/narrativeContent'
import { projectsApi } from '../api/projects'
import { sectionsApi } from '../api/sections'
import { skillCategoriesApi } from '../api/skills'
import { useFocusLater } from '../hooks/useFocusLater'
import AddContent from './AddContent'
import NameForm from './NameForm'
import OrderedList, { type ListItem, type ListKey } from './OrderedList'
import {
  entryItem,
  fromKey,
  KIND_NAMES,
  KINDS_IN_ORDER,
  listedIds,
  placedItem,
  savedItems,
  SHOWN_FIELDS,
  type Library,
} from './treeItems'

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
  note: string
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
        lockedNote={writing.note}
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

// "New version" on each row of a list of text (bullets, or narrative content): a form under the
// row that starts from its text. Changed text saves as a new library item, listed right after the
// original, and takes the original's place here; the original stays in the library. Unchanged
// text saves nothing. Focus moves into the form, and back to the row's button when it closes (the
// new version's, after saving, since it takes the same place).
function useNewVersion<K extends ListKey>(
  // Makes the buttons' ids unique on the page.
  idBase: string,
  items: ListItem<K>[],
  // A row's text, or null for a row that isn't text (a role in a section).
  textOf: (item: ListItem<K>) => string | null,
  onSave: (item: ListItem<K>, content: string) => Promise<void>,
  onNotice: (notice: string) => void,
) {
  const [editing, setEditing] = useState<K | null>(null)
  const focusLater = useFocusLater()
  const buttonId = (item: ListItem<K>) => `version-${idBase}-${items.findIndex((other) => other.id === item.id)}`

  function close(item: ListItem<K>) {
    setEditing(null)
    focusLater(buttonId(item))
  }

  return {
    actions: (item: ListItem<K>) =>
      textOf(item) === null || editing === item.id ? null : (
        <button
          type="button"
          id={buttonId(item)}
          aria-label={`New version of ${item.label ?? item.name}`}
          onClick={() => setEditing(item.id)}
        >
          New version
        </button>
      ),
    under: (item: ListItem<K>) => {
      const text = textOf(item)
      if (editing !== item.id || text === null) return null
      return (
        <NameForm
          label="New version"
          field="content"
          initial={text}
          lockedNote="Change the text, then save. The new version is saved to your library next to the original, and takes its place here. The original stays in your library."
          submitLabel="Save new version"
          multiline
          onSave={async (content) => {
            if (content.trim() === text.trim()) onNotice('The text is unchanged, so nothing was saved.')
            else await onSave(item, content.trim())
            close(item)
          }}
          onCancel={() => close(item)}
        />
      )
    },
  }
}

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
  onNotice,
}: {
  entry: TreeEntry
  // Null when read-only: nothing to add from.
  library: Library | null
  // Bullets elsewhere in the section, which can't be added here too (each goes in a section once).
  taken: Set<number>
  onSkills: (ids: number[]) => Promise<void>
  onBullets: (ids: number[]) => Promise<void>
  // A new bullet, or with `replaces`, a new version of one shown here.
  onWriteBullet: (content: string, replaces?: number) => Promise<void>
  onWriteSkill: (skillName: string) => Promise<void>
  onNotice: (notice: string) => void
}) {
  const name = placedItem(entry).name.replace(/^[^:]*: /, '')
  const readOnly = library === null
  const category =
    entry.kind === 'category' ? library?.categories.find((item) => item.category_id === entry.item_id) : undefined
  const project = entry.kind === 'project' ? library?.projects.find((item) => item.project_id === entry.item_id) : undefined
  const role =
    entry.kind === 'experience' ? library?.experience.find((item) => item.experience_id === entry.item_id) : undefined
  const skillChoices = (category?.skills ?? project?.skills ?? []).map((skill) => ({
    id: skill.skill_id,
    name: skill.skill_name,
  }))
  const bulletChoices = (role?.bullets ?? project?.bullets ?? [])
    .filter((bullet) => !taken.has(bullet.bullet_id))
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

  const versions = useNewVersion(
    `${entry.kind}-${entry.row_id}`,
    bullets,
    (item) => item.name,
    (item, content) => onWriteBullet(content, item.id),
    onNotice,
  )

  const shownFields = SHOWN_FIELDS[entry.kind]

  return (
    <>
      {shownFields && (
        <dl className="details-list">
          {shownFields.map((field) => (
            <Fragment key={field.name}>
              <dt>{field.label}</dt>
              <dd>{entry.values[field.name] || 'None'}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {(entry.kind === 'category' || entry.kind === 'project') && (
        <>
          <p className="list-label">Skills</p>
          <OrderedList
            label={`${name} skills`}
            items={entry.skills.map((skill) => ({ id: skill.item_id, name: skill.text }))}
            choices={skillChoices}
            emptyText={`No skills shown with ${name} yet.`}
            readOnly={readOnly}
            moreOptions
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
                  note:
                    entry.kind === 'category'
                      ? `It's saved to your library, listed under ${name}, and shown last here.`
                      : `It's saved to your library, listed under ${name} and the "Other" skill category, and shown last here.`,
                },
              ]}
              onWrite={(_, skillName) => onWriteSkill(skillName)}
            />
          )}
        </>
      )}
      {(entry.kind === 'experience' || entry.kind === 'project') && (
        <>
          <p className="list-label">Bullets</p>
          <OrderedList
            label={`${name} bullets`}
            items={bullets}
            choices={bulletChoices}
            emptyText={`No bullets shown with ${name} yet.`}
            readOnly={readOnly}
            moreOptions
            actions={versions.actions}
            under={versions.under}
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
                  note: `It's saved to your library, listed under ${name}, and shown last here.`,
                },
              ]}
              onWrite={(_, content) => onWriteBullet(content)}
            />
          )}
        </>
      )}
    </>
  )
}

// Narrative content and bullets are their text; every other kind opens to more.
const opens = (kind: EntryKind) => kind !== 'narrative' && kind !== 'bullet'

const NEW_VERSION_SAVED = 'Saved the new version. The original is still in your library.'

// What opens under one of the document's sections: the items placed in it, each opening to
// what's under it, then adding more.
function SectionBody({
  kind,
  doc,
  section,
  library,
  saved,
  written,
  onNotice,
}: {
  kind: DocKind
  doc: DocDetail
  section: TreeSection
  // Null when read-only.
  library: Library | null
  saved: (request: Promise<DocDetail>) => Promise<void>
  written: (request: Promise<DocDetail>, notice: string) => Promise<void>
  onNotice: (notice: string) => void
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
  const versions = useNewVersion(
    `section-${section.row_id}`,
    items,
    (item) => {
      const entry = entryOf(item)
      return entry && !opens(entry.kind) ? (entry.values.content ?? '') : null
    },
    async (item, content) => {
      const entry = entryOf(item)
      if (!entry) return
      await written(
        api.write(doc.id, section.row_id, { kind: entry.kind, content }, entry.item_id),
        NEW_VERSION_SAVED,
      )
    },
    onNotice,
  )

  return (
    <>
      <OrderedList
        label={`Items in ${section.title}`}
        items={items}
        choices={choices}
        emptyText="Nothing here yet."
        readOnly={readOnly}
        moreOptions
        // Each comes with its own defaults.
        onAdd={(keys) => saved(api.placeItems(doc.id, section.row_id, keys.map(fromKey)))}
        actions={versions.actions}
        under={versions.under}
        details={(item) => {
          const entry = entryOf(item)
          if (!entry || !opens(entry.kind)) return null
          const parent = entry.kind === 'project' ? 'project' : 'experience'
          return (
            <EntryChildren
              entry={entry}
              library={library}
              taken={bulletsHere(entry)}
              onSkills={(ids) =>
                saved(api.setSkills(doc.id, entry.kind === 'project' ? 'project' : 'category', entry.row_id, ids))
              }
              onBullets={(ids) => saved(api.setBullets(doc.id, parent, entry.row_id, ids))}
              onWriteSkill={(skillName) =>
                written(
                  api.writeSkill(doc.id, entry.kind === 'project' ? 'project' : 'category', entry.row_id, skillName),
                  "Added the new skill. It's saved in your library too.",
                )
              }
              onWriteBullet={(content, replaces) =>
                written(
                  api.writeBullet(doc.id, parent, entry.row_id, content, replaces),
                  replaces === undefined ? "Added the new bullet. It's saved in your library too." : NEW_VERSION_SAVED,
                )
              }
              onNotice={onNotice}
            />
          )
        }}
        onChange={(keys) => saved(api.setItems(doc.id, section.row_id, keys.map(fromKey)))}
      />
      {library && (
        <AddContent
          section={section}
          library={library}
          onAdd={(addKind, itemId) => saved(api.placeItems(doc.id, section.row_id, [{ kind: addKind, item_id: itemId }]))}
          onWrite={(item) =>
            written(
              api.write(doc.id, section.row_id, item),
              `Added the new ${KIND_NAMES[item.kind].lower}. It's saved in your library too.`,
            )
          }
        />
      )}
    </>
  )
}

export default function DocumentTree({
  kind,
  doc,
  readOnly,
  onChange,
  onNotice,
}: {
  kind: DocKind
  doc: DocDetail
  // Sent, or a base version before the user chose to edit it: only shown.
  readOnly: boolean
  // The document with its new tree and output, after each saved change.
  onChange: (doc: DocDetail) => void
  onNotice: (notice: string) => void
}) {
  const [library, setLibrary] = useState<Library | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const api = docsApi(kind)

  const load = useCallback(
    () =>
      Promise.all([
        sectionsApi.list(),
        narrativeApi.list(),
        skillCategoriesApi.list(),
        experienceApi.list(),
        projectsApi.list(),
        bulletsApi.list(),
        educationApi.list(),
      ])
        .then(([sections, narrative, categories, experience, projects, bullets, education]) => {
          setLibrary({ sections, narrative, categories, experience, projects, bullets, education })
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
        items={doc.sections.map((section) => ({ id: section.section_id, name: section.title }))}
        choices={shown ? shown.sections.map((section) => ({ id: section.id, name: section.title })) : []}
        emptyText={readOnly ? 'No sections.' : 'No sections yet. Add one to start.'}
        readOnly={readOnly}
        moreOptions
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
              onNotice={onNotice}
            />
          ) : null
        }}
        onChange={(ids) => saved(api.setSections(doc.id, ids))}
      />
      {!readOnly && (
        <p className="muted">Removing a section takes out everything placed in it here. The library keeps it all.</p>
      )}
    </>
  )
}
