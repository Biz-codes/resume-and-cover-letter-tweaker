// Library page for narrative content: every excerpt (one sentence up to a full paragraph), adding
// excerpts, and each one's dialog (ItemDialog), where it's edited, given a new version, or
// deleted. The add and edit forms also choose every section that lists the excerpt. Excerpts no section lists come first, so they can
// be listed again or deleted (docs/FRONTEND_CHECKS.md, "Unlisted items"). Editing the text of an
// excerpt a sent version uses saves a new excerpt ("Sent versions are locked").
import { useCallback, useEffect, useState } from 'react'
import { shortBullet } from '../shared/api/bullets'
import { toApiError, type ApiError } from '../shared/api/client'
import { narrativeApi, type NarrativeContent } from '../shared/api/narrativeContent'
import { sectionsApi, type Section } from '../shared/api/sections'
import { anyLocked } from '../shared/api/usage'
import Checklist from '../shared/components/Checklist'
import ConfirmDelete from '../shared/components/ConfirmDelete'
import FieldsForm, { type Field } from '../shared/components/FieldsForm'
import ItemDialog from './ItemDialog'
import LibraryCard from './LibraryCard'
import UsedBy from './UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'

interface ExcerptFields {
  content: string
}

const FIELDS: Field<ExcerptFields>[] = [
  { name: 'content', label: 'Narrative content text', required: true, multiline: true },
]

const LOCKED_NOTE = 'A sent version uses this excerpt, so saving adds a new one. The sent version keeps this one.'

// Ids of the buttons that open a form or dialog, where focus returns when it closes.
const NEW_EXCERPT_ID = 'new-excerpt'
const editId = (id: number) => `narrative-${id}-edit`

export default function NarrativeContentPage() {
  const [excerpts, setExcerpts] = useState<NarrativeContent[] | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [adding, setAdding] = useState(false)
  // The excerpt whose dialog is open.
  const [editing, setEditing] = useState<number | null>(null)
  // The sections checked in the open form.
  const [chosen, setChosen] = useState<number[]>([])
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Narrative content')

  const load = useCallback(
    () =>
      Promise.all([narrativeApi.list(), sectionsApi.list()])
        .then(([excerptList, sectionList]) => {
          setExcerpts(excerptList)
          setSections(sectionList)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  function openItem(excerpt: NarrativeContent) {
    setAdding(false)
    setEditing(excerpt.content_id)
    setChosen(excerpt.sections.map((section) => section.id))
    setDeleteError(null)
    setNotice(null)
  }

  async function saved(excerpt: NarrativeContent, message: string) {
    setAdding(false)
    setEditing(null)
    await load()
    setNotice(message)
    focusLater(editId(excerpt.content_id))
  }

  async function create({ content }: ExcerptFields) {
    const excerpt = await narrativeApi.create(content, chosen)
    await saved(excerpt, `Added "${shortBullet(excerpt.content)}".`)
  }

  async function update(original: NarrativeContent, { content }: ExcerptFields) {
    const excerpt = await narrativeApi.update(original.content_id, content, chosen)
    await saved(
      excerpt,
      excerpt.content_id === original.content_id
        ? 'Saved.'
        : 'Saved as a new excerpt, listed right after the original. Sent versions keep the original.',
    )
  }

  async function addVersion(original: NarrativeContent, { content }: ExcerptFields) {
    const excerpt = await narrativeApi.addVersion(original.content_id, content)
    await saved(
      excerpt,
      excerpt.content_id === original.content_id
        ? 'Nothing changed, so no new version was added.'
        : 'Added a new version, listed right after the original. Resumes and cover letters keep the original until you pick the new one.',
    )
  }

  async function confirmDelete(excerpt: NarrativeContent) {
    setDeleteError(null)
    try {
      await narrativeApi.delete(excerpt.content_id)
      setEditing(null)
      focusLater(PAGE_HEADING_ID)
      await load()
      setNotice(`Deleted "${shortBullet(excerpt.content)}".`)
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  const sectionChoices = sections.map((section) => ({ id: section.id, name: section.title }))
  const sectionPicker = (
    <Checklist legend="Sections that list it" options={sectionChoices} selected={chosen} onChange={setChosen} />
  )

  function card(excerpt: NarrativeContent) {
    return (
      <LibraryCard
        key={excerpt.content_id}
        title={excerpt.content}
        titleClassName="bullet-text"
        editId={editId(excerpt.content_id)}
        editLabel={`Edit "${shortBullet(excerpt.content)}"`}
        onEdit={() => openItem(excerpt)}
      />
    )
  }

  function itemDialog(excerpt: NarrativeContent) {
    const label = `"${shortBullet(excerpt.content)}"`
    return (
      <ItemDialog
        title={shortBullet(excerpt.content)}
        onClose={() => setEditing(null)}
        form={
          <FieldsForm
            label={`Edit ${label}`}
            fields={FIELDS}
            initial={{ content: excerpt.content }}
            note={anyLocked(excerpt.used_by) ? LOCKED_NOTE : undefined}
            onSave={(fields) => update(excerpt, fields)}
            onCancel={() => setEditing(null)}
          >
            {sectionPicker}
          </FieldsForm>
        }
        newVersion={(back) => (
          <FieldsForm
            label={`New version of ${label}`}
            fields={FIELDS}
            initial={{ content: excerpt.content }}
            submitLabel="Add version"
            onSave={(fields) => addVersion(excerpt, fields)}
            onCancel={back}
          />
        )}
        confirmDelete={(back) => (
          <ConfirmDelete
            what={label}
            uses={excerpt.used_by}
            effect="It's removed from them, and from every section."
            error={deleteError}
            onConfirm={() => void confirmDelete(excerpt)}
            onCancel={back}
          />
        )}
      >
        <UsedBy uses={excerpt.used_by} />
      </ItemDialog>
    )
  }

  const editingExcerpt = excerpts?.find((excerpt) => excerpt.content_id === editing)
  const unlisted = excerpts?.filter((excerpt) => excerpt.sections.length === 0) ?? []
  const listed = excerpts?.filter((excerpt) => excerpt.sections.length > 0) ?? []

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Narrative content
      </h2>
      <p className="muted">
        The text of resume summaries and cover letter paragraphs. Each excerpt can be anything from one sentence to a
        full paragraph, grouped however you choose.
      </p>
      <p className="muted">
        You can use this flexibility to save narrative content in the chunks for maximum writing efficiency. For
        example, if the same paragraph goes in many resumes with only the first sentence changed, save each first
        sentence as its own excerpt, and the rest of the paragraph as one excerpt. Each excerpt is stored once and can
        be listed under any number of sections. Write new excerpts here OR on the Sections page, under a section where
        you plan to use them.
      </p>
      <p role="status">{notice}</p>
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!excerpts && !loadError && <p>Loading…</p>}

      {adding ? (
        <FieldsForm
          label="New excerpt"
          fields={FIELDS}
          initial={{ content: '' }}
          submitLabel="Add excerpt"
          onSave={create}
          onCancel={() => {
            setAdding(false)
            focusLater(NEW_EXCERPT_ID)
          }}
        >
          {sectionPicker}
        </FieldsForm>
      ) : (
        excerpts && (
          <button
            type="button"
            id={NEW_EXCERPT_ID}
            onClick={() => {
              setAdding(true)
              setChosen([])
              setNotice(null)
            }}
          >
            New excerpt
          </button>
        )
      )}

      {unlisted.length > 0 && (
        <div className="section-group">
          <h3>Not listed anywhere</h3>
          <p className="muted">No section lists these. Edit them to choose sections, or delete them.</p>
          {unlisted.map(card)}
        </div>
      )}
      {excerpts && <h3>Listed narrative content</h3>}
      {excerpts && listed.length === 0 && <p>No narrative content yet.</p>}
      {listed.map(card)}
      {editingExcerpt && itemDialog(editingExcerpt)}
    </section>
  )
}
