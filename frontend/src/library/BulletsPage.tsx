// Library page for bullet points: every bullet, and its dialog (ItemDialog), where it's edited,
// given a new version, or deleted, with where it's listed and used. New bullets are written under a role, project, or section on those pages. Bullets no role,
// project, or section lists come first, so they can be listed again or deleted
// (docs/FRONTEND_CHECKS.md, "Unlisted items"). Editing a bullet a sent version uses saves a
// new bullet ("Sent versions are locked").
import { useCallback, useEffect, useState } from 'react'
import { bulletsApi, shortBullet, type Bullet } from '../shared/api/bullets'
import { toApiError, type ApiError } from '../shared/api/client'
import { experienceLabel } from '../shared/api/experience'
import { projectLabel } from '../shared/api/projects'
import { anyLocked } from '../shared/api/usage'
import ConfirmDelete from '../shared/components/ConfirmDelete'
import NameForm from '../shared/components/NameForm/NameForm'
import ItemDialog from './ItemDialog'
import LibraryCard from './LibraryCard'
import NameList from './NameList'
import UsedBy from './UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'

const LOCKED_NOTE = 'A sent version uses this bullet, so saving adds a new one. The sent version keeps this one.'

// The Edit button's id, where focus returns when the dialog closes after a save.
const editId = (id: number) => `bullet-${id}-edit`

const isListed = (bullet: Bullet) => bullet.experience.length + bullet.projects.length + bullet.sections.length > 0

export default function BulletsPage() {
  const [bullets, setBullets] = useState<Bullet[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  // The bullet whose dialog is open.
  const [editing, setEditing] = useState<number | null>(null)
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
    await load()
    setNotice(
      saved.bullet_id === bullet.bullet_id
        ? 'Saved.'
        : 'Saved as a new bullet, listed right after the original. Sent versions keep the original.',
    )
    focusLater(editId(saved.bullet_id))
  }

  async function addVersion(bullet: Bullet, content: string) {
    const version = await bulletsApi.addVersion(bullet.bullet_id, content)
    setEditing(null)
    await load()
    setNotice(
      version.bullet_id === bullet.bullet_id
        ? 'Nothing changed, so no new version was added.'
        : 'Added a new version, listed right after the original. Resumes and cover letters keep the original until you pick the new one.',
    )
    focusLater(editId(version.bullet_id))
  }

  async function confirmDelete(bullet: Bullet) {
    setDeleteError(null)
    try {
      await bulletsApi.delete(bullet.bullet_id)
      setEditing(null)
      focusLater(PAGE_HEADING_ID)
      await load()
      setNotice(`Deleted "${shortBullet(bullet.content)}".`)
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  function card(bullet: Bullet) {
    return (
      <LibraryCard
        key={bullet.bullet_id}
        title={bullet.content}
        titleClassName="bullet-text"
        editId={editId(bullet.bullet_id)}
        editLabel={`Edit "${shortBullet(bullet.content)}"`}
        onEdit={() => {
          setEditing(bullet.bullet_id)
          setDeleteError(null)
          setNotice(null)
        }}
      />
    )
  }

  function itemDialog(bullet: Bullet) {
    const label = `"${shortBullet(bullet.content)}"`
    return (
      <ItemDialog
        title={shortBullet(bullet.content)}
        onClose={() => setEditing(null)}
        form={
          <NameForm
            label="Bullet text"
            field="content"
            initial={bullet.content}
            multiline
            lockedNote={anyLocked(bullet.used_by) ? LOCKED_NOTE : undefined}
            onSave={(content) => save(bullet, content)}
            onCancel={() => setEditing(null)}
          />
        }
        newVersion={(back) => (
          <NameForm
            label="New version's text"
            field="content"
            initial={bullet.content}
            multiline
            submitLabel="Add version"
            onSave={(content) => addVersion(bullet, content)}
            onCancel={back}
          />
        )}
        confirmDelete={(back) => (
          <ConfirmDelete
            what={label}
            uses={bullet.used_by}
            effect="It's removed from them, and from every role, project, and section."
            error={deleteError}
            onConfirm={() => void confirmDelete(bullet)}
            onCancel={back}
          />
        )}
      >
        <NameList title="Roles" names={bullet.experience.map(experienceLabel)} />
        <NameList title="Projects" names={bullet.projects.map(projectLabel)} />
        <NameList title="Sections" names={bullet.sections.map((section) => section.title)} />
        <UsedBy uses={bullet.used_by} />
      </ItemDialog>
    )
  }

  const editingBullet = bullets?.find((bullet) => bullet.bullet_id === editing)
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
      {editingBullet && itemDialog(editingBullet)}
    </section>
  )
}
