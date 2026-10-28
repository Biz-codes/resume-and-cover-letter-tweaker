// Library page for bullet points: every bullet, where it's listed, and editing and deleting
// it. New bullets are written under a role, project, or section on those pages. Bullets no role,
// project, or section lists come first, so they can be listed again or deleted
// (docs/FRONTEND_CHECKS.md, "Unlisted items"). Editing a bullet a sent version uses saves a
// new bullet ("Sent versions are locked").
import { useCallback, useEffect, useState } from 'react'
import { bulletsApi, shortBullet, type Bullet } from '../api/bullets'
import { toApiError, type ApiError } from '../api/client'
import { experienceLabel } from '../api/experience'
import { projectLabel } from '../api/projects'
import { anyLocked } from '../api/usage'
import ConfirmDelete from '../components/ConfirmDelete'
import NameForm from '../components/NameForm'
import NameList from '../components/NameList'
import UsedBy from '../components/UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

const LOCKED_NOTE =
  'A sent version uses this bullet, so your change will be saved as a new bullet, listed right after this one. Sent versions keep this one; unsent ones switch to the new one.'

const buttonId = (id: number, action: 'edit' | 'delete') => `bullet-${id}-${action}`

const isListed = (bullet: Bullet) => bullet.experience.length + bullet.projects.length + bullet.sections.length > 0

export default function BulletsPage() {
  const [bullets, setBullets] = useState<Bullet[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
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

  async function save(bullet: Bullet, content: string) {
    const saved = await bulletsApi.update(bullet.bullet_id, content)
    setEditing(null)
    setNotice(
      saved.bullet_id === bullet.bullet_id
        ? 'Saved.'
        : 'Saved as a new bullet, listed right after the original. Sent versions keep the original.',
    )
    await load()
    focusLater(buttonId(saved.bullet_id, 'edit'))
  }

  async function confirmDelete(bullet: Bullet) {
    setDeleteError(null)
    try {
      await bulletsApi.delete(bullet.bullet_id)
      setDeleting(null)
      focusLater(PAGE_HEADING_ID)
      setNotice(`Deleted "${shortBullet(bullet.content)}".`)
      await load()
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  function card(bullet: Bullet) {
    const label = `"${shortBullet(bullet.content)}"`
    return (
      <article key={bullet.bullet_id} className="card">
        {editing === bullet.bullet_id ? (
          <NameForm
            label="Bullet text"
            field="content"
            initial={bullet.content}
            multiline
            lockedNote={anyLocked(bullet.used_by) ? LOCKED_NOTE : undefined}
            onSave={(content) => save(bullet, content)}
            onCancel={() => {
              setEditing(null)
              focusLater(buttonId(bullet.bullet_id, 'edit'))
            }}
          />
        ) : (
          <h4 className="bullet-text">{bullet.content}</h4>
        )}
        <NameList title="Roles" names={bullet.experience.map(experienceLabel)} />
        <NameList title="Projects" names={bullet.projects.map(projectLabel)} />
        <NameList title="Sections" names={bullet.sections.map((section) => section.title)} />
        <UsedBy uses={bullet.used_by} />
        {editing !== bullet.bullet_id &&
          (deleting === bullet.bullet_id ? (
            <ConfirmDelete
              what={label}
              uses={bullet.used_by}
              effect="It's removed from them, and from every role, project, and section."
              error={deleteError}
              onConfirm={() => void confirmDelete(bullet)}
              onCancel={() => {
                setDeleting(null)
                focusLater(buttonId(bullet.bullet_id, 'delete'))
              }}
            />
          ) : (
            <div className="actions">
              <button
                type="button"
                id={buttonId(bullet.bullet_id, 'edit')}
                aria-label={`Edit ${label}`}
                onClick={() => {
                  setEditing(bullet.bullet_id)
                  setDeleting(null)
                  setNotice(null)
                }}
              >
                Edit
              </button>
              <button
                type="button"
                id={buttonId(bullet.bullet_id, 'delete')}
                aria-label={`Delete ${label}`}
                onClick={() => {
                  setDeleting(bullet.bullet_id)
                  setDeleteError(null)
                  setEditing(null)
                }}
              >
                Delete
              </button>
            </div>
          ))}
      </article>
    )
  }

  const unlisted = bullets?.filter((bullet) => !isListed(bullet)) ?? []
  const listed = bullets?.filter(isListed) ?? []

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Bullet points
      </h2>
      <p className="muted">
        Each bullet is stored once and can be listed under any number of roles, projects, and sections.
        Write new bullets on the Experience, Projects, or Sections page, where they're listed.
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
      {!bullets && !loadError && <p>Loading…</p>}

      {unlisted.length > 0 && (
        <div className="section-group">
          <h3>Not listed anywhere</h3>
          <p className="muted">
            No role, project, or section lists these. Add them to one on its page, or delete them.
          </p>
          {unlisted.map(card)}
        </div>
      )}
      {bullets && <h3>Listed bullets</h3>}
      {bullets && listed.length === 0 && <p>No bullets yet.</p>}
      {listed.map(card)}
    </section>
  )
}
