// Library page for narrative content: every excerpt (one sentence up to a full paragraph), adding
// excerpts, and each one's dialog (NarrativeItem), where it's edited, given a new version, or
// deleted. The add and edit forms also choose every section that lists the excerpt. Excerpts no
// section lists come first, so they can be listed again or deleted (docs/FRONTEND_CHECKS.md,
// "Unlisted items").
import { useCallback, useEffect, useState } from 'react'
import { shortBullet } from '../shared/api/bullets'
import { toApiError, type ApiError } from '../shared/api/client'
import { narrativeApi, type NarrativeContent } from '../shared/api/narrativeContent'
import { sectionsApi, type Section } from '../shared/api/sections'
import Checklist from '../shared/components/Checklist'
import FieldsForm from '../shared/components/FieldsForm'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import { EXCERPT_FIELDS, type ExcerptFields } from './items/itemFields'
import LibraryCard from './LibraryCard'

// The New excerpt button, where focus returns when its form closes.
const NEW_EXCERPT_ID = 'new-excerpt'

export default function NarrativeContentPage() {
  const [excerpts, setExcerpts] = useState<NarrativeContent[] | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [adding, setAdding] = useState(false)
  // The sections checked in the new excerpt's form.
  const [chosen, setChosen] = useState<number[]>([])
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

  const dialogs = useItemDialogs({ reload: load, notify: setNotice })

  async function create({ content }: ExcerptFields) {
    const excerpt = await narrativeApi.create(content, chosen)
    setAdding(false)
    await load()
    setNotice(`Added "${shortBullet(excerpt.content)}".`)
    focusLater(editId('narrative', excerpt.content_id))
  }

  const sectionPicker = (
    <Checklist
      legend="Sections that list it"
      options={sections.map((section) => ({ id: section.id, name: section.title }))}
      selected={chosen}
      onChange={setChosen}
    />
  )

  function card(excerpt: NarrativeContent) {
    const title = shortBullet(excerpt.content)
    return (
      <LibraryCard
        key={excerpt.content_id}
        title={excerpt.content}
        titleClassName="bullet-text"
        editId={editId('narrative', excerpt.content_id)}
        editLabel={`Edit "${title}"`}
        onEdit={() => {
          setAdding(false)
          dialogs.open({ kind: 'narrative', id: excerpt.content_id, title })
        }}
      />
    )
  }

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
          fields={EXCERPT_FIELDS}
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
      {dialogs.dialog}
    </section>
  )
}
