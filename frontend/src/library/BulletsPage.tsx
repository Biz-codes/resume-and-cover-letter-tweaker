// Library page for bullet points: every bullet, and its dialog (BulletItem), where it's edited or
// deleted, with where it's listed and used. New bullets are written under
// a role, project, or section on those pages. Bullets no role, project, or section lists come
// first, so they can be listed again or deleted (docs/FRONTEND_CHECKS.md, "Unlisted items").
import { useCallback, useEffect, useState } from 'react'
import { bulletsApi, shortBullet, type Bullet } from '../shared/api/bullets'
import { toApiError, type ApiError } from '../shared/api/client'
import { PAGE_HEADING_ID } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import HiddenItems, { UnhideButton } from './HiddenItems'
import LibraryCard from './LibraryCard'
import { SORT_NOTE, sortByName } from '../shared/sortByName'
import { useUnhide } from './useUnhide'
import AlertDialog from '../shared/components/Dialog/AlertDialog'

const isListed = (bullet: Bullet) => bullet.experience.length + bullet.projects.length + bullet.sections.length > 0

export default function BulletsPage() {
  const [bullets, setBullets] = useState<Bullet[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  usePageTitle('Bullet points')

  const load = useCallback(
    () =>
      bulletsApi
        .list()
        .then((list) => {
          setBullets(list)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const dialogs = useItemDialogs({ reload: load, notify: setNotice })
  const unhide = useUnhide(load, setNotice)

  // `hidden`: a card in the Hidden group, with Unhide.
  function card(bullet: Bullet, hidden = false) {
    const title = shortBullet(bullet.content)
    return (
      <LibraryCard
        key={bullet.bullet_id}
        title={bullet.content}
        titleClassName="bullet-text"
        editId={editId('bullet', bullet.bullet_id)}
        editLabel={`View and Edit "${title}"`}
        actions={hidden && <UnhideButton name={title} onUnhide={() => unhide('bullet', bullet.bullet_id, title, () => bulletsApi.setHidden(bullet.bullet_id, false))} />}
        onEdit={() => dialogs.open({ kind: 'bullet', id: bullet.bullet_id, title })}
      />
    )
  }

  const all = sortByName(bullets ?? [], (bullet) => bullet.content)
  const hiddenOnes = all.filter((bullet) => bullet.hidden)
  const sorted = all.filter((bullet) => !bullet.hidden)
  const unlisted = sorted.filter((bullet) => !isListed(bullet))
  const listed = sorted.filter(isListed)

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Bullet points
      </h2>
      <p className="muted">
        Each bullet is stored once and can be listed under any number of roles, projects, and sections.
        Write new bullets on the Experience, Projects, or Sections page, where they're listed.
      </p>
      <p className="muted">{SORT_NOTE}</p>
      <AlertDialog message={notice} onClose={() => setNotice(null)} />
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!bullets && !loadError && <p>Loading…</p>}

      {unlisted.length > 0 && (
        <div className="section-group">
          <h3>Not listed anywhere</h3>
          <p className="muted">
            No role, project, or section lists these. Add them to one on its page, or delete them.
          </p>
          {unlisted.map((item) => card(item))}
        </div>
      )}
      {bullets && <h3>Listed bullets</h3>}
      {bullets && listed.length === 0 && <p>No bullets yet.</p>}
      {listed.map((item) => card(item))}
      <HiddenItems count={hiddenOnes.length}>{hiddenOnes.map((bullet) => card(bullet, true))}</HiddenItems>
      {dialogs.dialog}
    </section>
  )
}
