// Library page for tones: named groups of tone rules (docs/WRITING_RULES.md, "Tone rules"). The
// database and API call a tone a tone set (tone_set); the app says "tone". Add tones, and open
// each one's dialog (ToneItem) to rename it, add a version of it, delete it, and edit its rules.
// A resume or cover letter can use one tone.
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { toneSetsApi, type ToneSet } from '../shared/api/toneSets'
import NameForm from '../shared/components/NameForm/NameForm'
import { PAGE_HEADING_ID } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import LibraryCard from './LibraryCard'

export default function ToneSetsPage() {
  const [sets, setSets] = useState<ToneSet[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  usePageTitle('Tones')

  const load = useCallback(
    () =>
      toneSetsApi
        .list()
        .then((list) => {
          setSets(list)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const dialogs = useItemDialogs({ reload: load, notify: setNotice })

  async function create(name: string) {
    await toneSetsApi.create(name)
    await load()
    setNotice(`Added "${name.trim()}".`)
  }

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Tones
      </h2>
      <p className="muted">
        Different kinds of jobs call for different word choice: a tech resume might lead with tools and metrics, a
        teaching one with students and outcomes. Each resume or cover letter can use one tone, and its rules guide every
        suggestion for it.
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
      {!sets && !loadError && <p>Loading…</p>}

      {sets && <NameForm label="New tone name" field="name" submitLabel="Add tone" onSave={create} />}
      {sets && sets.length === 0 && <p>No tones yet.</p>}
      {sets?.map((toneSet) => (
        <LibraryCard
          key={toneSet.tone_set_id}
          title={toneSet.name}
          heading={3}
          editId={editId('tone', toneSet.tone_set_id)}
          editLabel={`Edit "${toneSet.name}"`}
          onEdit={() => dialogs.open({ kind: 'tone', id: toneSet.tone_set_id, title: toneSet.name })}
        >
          <p className="muted">{toneSet.rules.length === 1 ? '1 rule' : `${toneSet.rules.length} rules`}</p>
        </LibraryCard>
      ))}
      {dialogs.dialog}
    </section>
  )
}
