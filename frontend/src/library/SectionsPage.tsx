// Library page for sections: add sections, and open each one's dialog (SectionItem) to rename it,
// add a version of it, delete it, and edit what it lists. Built-in sections can't be renamed or
// deleted (docs/FRONTEND_CHECKS.md). Sections are grouped by whether their titles print: resume
// headings do, cover letter section titles are labels only the user sees (docs/DATABASE.md,
// section notes).
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { sectionsApi, type Section } from '../shared/api/sections'
import NameForm from '../shared/components/NameForm/NameForm'
import { PAGE_HEADING_ID } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import LibraryCard from './LibraryCard'

type Group = 'resume' | 'letter' | 'unused'

const GROUPS: { group: Group; heading: string; note: string }[] = [
  { group: 'resume', heading: 'Resume headings', note: 'Printed as headings in your resumes.' },
  {
    group: 'letter',
    heading: 'Cover letter labels',
    note: "Only you see these. Cover letters don't print section titles.",
  },
  {
    group: 'unused',
    heading: 'Not used yet',
    note: 'Printed if you use one in a resume; only a label in a cover letter.',
  },
]

function groupOf(section: Section): Group {
  if (section.built_in || section.used_by.some((use) => use.kind === 'resume')) return 'resume'
  return section.used_by.some((use) => use.kind === 'cover_letter') ? 'letter' : 'unused'
}

export default function SectionsPage() {
  const [sections, setSections] = useState<Section[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  usePageTitle('Sections')

  const load = useCallback(
    () =>
      sectionsApi
        .list()
        .then((list) => {
          setSections(list)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const dialogs = useItemDialogs({ reload: load, notify: setNotice })

  async function create(title: string) {
    await sectionsApi.create(title)
    await load()
    setNotice(`Added "${title.trim()}".`)
  }

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Sections
      </h2>
      <p className="muted">
        Resume headings and cover letter topics. Any content can go in any section; the lists here
        are only what the app suggests first.
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
      {!sections && !loadError && <p>Loading…</p>}

      {sections && <NameForm label="New section title" field="title" submitLabel="Add section" onSave={create} />}

      {sections &&
        GROUPS.map(({ group, heading, note }) => {
          const members = sections.filter((section) => groupOf(section) === group)
          if (members.length === 0) return null
          return (
            <div key={group} className="section-group">
              <h3>{heading}</h3>
              <p className="muted">{note}</p>
              {members.map((section) => (
                <LibraryCard
                  key={section.id}
                  title={section.title}
                  tags={
                    <>
                      {section.built_in && <span className="tag">built in</span>}
                      {group === 'resume' && section.used_by.some((use) => use.kind === 'cover_letter') && (
                        <span className="tag">also a cover letter label</span>
                      )}
                    </>
                  }
                  editId={editId('section', section.id)}
                  editLabel={`Edit "${section.title}"`}
                  onEdit={() => dialogs.open({ kind: 'section', id: section.id, title: section.title })}
                />
              ))}
            </div>
          )
        })}
      {dialogs.dialog}
    </section>
  )
}
