// Library page for skill categories and skills: adding both, and each one's dialog (ItemDialog),
// where it's renamed, given a new version, or deleted, with a category's ordered skill list. Rules from docs/FRONTEND_CHECKS.md: "Other" is built in,
// every skill keeps a category, and deleting a category moves its skills under "Other".
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { projectLabel } from '../shared/api/projects'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../shared/api/sections'
import { OTHER_CATEGORY_ID, skillCategoriesApi, skillsApi, type Skill, type SkillCategory } from '../shared/api/skills'
import { anyLocked } from '../shared/api/usage'
import Collapsible from './Collapsible/Collapsible'
import ConfirmDelete from '../shared/components/ConfirmDelete'
import NameForm from '../shared/components/NameForm/NameForm'
import ItemDialog from './ItemDialog'
import LibraryCard from './LibraryCard'
import NameList from './NameList'
import OrderedList from '../shared/components/OrderedList/OrderedList'
import UsedBy from './UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'

const lockedNote = (what: string) =>
  `A sent version uses this ${what}, so the new name is saved as a new ${what}. The sent version keeps the old one.`

type Target = { kind: 'category' | 'skill'; id: number }

// Each card's Edit button id, where focus returns when the dialog closes after a save.
const editId = (kind: Target['kind'], id: number) => `${kind}-${id}-edit`

export default function SkillsPage() {
  const [categories, setCategories] = useState<SkillCategory[] | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [newCategorySection, setNewCategorySection] = useState(String(BUILT_IN_SECTION_IDS.skills))
  // The category or skill whose dialog is open.
  const [editing, setEditing] = useState<Target | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Said in the dialog, for a change that keeps it open (something new written in it).
  const [dialogNotice, setDialogNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Skills')

  const load = useCallback(
    () =>
      Promise.all([skillCategoriesApi.list(), skillsApi.list(), sectionsApi.list()])
        .then(([categoryList, skillList, sectionList]) => {
          setCategories(categoryList)
          setSkills(skillList)
          setSections(sectionList)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const skillChoices = skills.map((skill) => ({ id: skill.skill_id, name: skill.skill_name }))

  function openItem(target: Target) {
    setEditing(target)
    setDialogNotice(null)
    setDeleteError(null)
    setNotice(null)
  }

  async function remove(target: Target, name: string) {
    setDeleteError(null)
    try {
      await (target.kind === 'category' ? skillCategoriesApi.delete(target.id) : skillsApi.delete(target.id))
      setEditing(null)
      focusLater(PAGE_HEADING_ID)
      await load()
      setNotice(`Deleted "${name}".`)
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  async function saved(target: Target, message: string) {
    setEditing(null)
    await load()
    setNotice(message)
    focusLater(editId(target.kind, target.id))
  }

  async function renameCategory(category: SkillCategory, name: string) {
    const renamed = await skillCategoriesApi.rename(category.category_id, name)
    await saved(
      { kind: 'category', id: renamed.category_id },
      renamed.category_id === category.category_id
        ? 'Saved.'
        : `Saved as a new category, "${renamed.category_name}". Sent versions keep "${category.category_name}".`,
    )
  }

  async function categoryVersion(category: SkillCategory, name: string) {
    const version = await skillCategoriesApi.addVersion(category.category_id, name)
    await saved(
      { kind: 'category', id: version.category_id },
      `Added "${version.category_name}", with the same skills. Resumes and cover letters keep "${category.category_name}" until you pick the new one.`,
    )
  }

  async function renameSkill(skill: Skill, name: string) {
    const renamed = await skillsApi.rename(skill.skill_id, name)
    await saved(
      { kind: 'skill', id: renamed.skill_id },
      renamed.skill_id === skill.skill_id
        ? 'Saved.'
        : `Saved as a new skill, "${renamed.skill_name}". Sent versions keep "${skill.skill_name}".`,
    )
  }

  async function skillVersion(skill: Skill, name: string) {
    const version = await skillsApi.addVersion(skill.skill_id, name)
    await saved(
      { kind: 'skill', id: version.skill_id },
      `Added "${version.skill_name}", listed right after "${skill.skill_name}". Resumes and cover letters keep "${skill.skill_name}" until you pick the new one.`,
    )
  }

  // "Other" can't be renamed or deleted, so its dialog has only New version and its skills.
  function categoryDialog(category: SkillCategory) {
    const target: Target = { kind: 'category', id: category.category_id }
    return (
      <ItemDialog
        notice={dialogNotice}
        title={category.category_name}
        onClose={() => setEditing(null)}
        form={
          !category.built_in && (
            <NameForm
              label="Category name"
              field="category_name"
              initial={category.category_name}
              lockedNote={anyLocked(category.used_by) ? lockedNote('category') : undefined}
              onSave={(name) => renameCategory(category, name)}
              onCancel={() => setEditing(null)}
            />
          )
        }
        newVersion={(back) => (
          <NameForm
            label="New version's name"
            field="category_name"
            initial={category.category_name}
            submitLabel="Add version"
            onSave={(name) => categoryVersion(category, name)}
            onCancel={back}
          />
        )}
        confirmDelete={
          category.built_in
            ? undefined
            : (back) => (
                <ConfirmDelete
                  what={`"${category.category_name}"`}
                  uses={category.used_by}
                  effect='They keep showing its skills, under "Other".'
                  error={deleteError}
                  onConfirm={() => void remove(target, category.category_name)}
                  onCancel={back}
                />
              )
        }
      >
        {category.built_in ? (
          <p className="muted">Offered wherever skills are added.</p>
        ) : (
          <NameList title="Sections that list it" names={category.sections.map((section) => section.title)} />
        )}

        <Collapsible title="Skills" count={category.skills.length}>
          <OrderedList
            label={`${category.category_name} skills`}
            items={category.skills.map((skill) => ({ id: skill.skill_id, name: skill.skill_name }))}
            choices={skillChoices}
            emptyText="No skills yet."
            onChange={async (ids) => {
              await skillCategoriesApi.setSkills(category.category_id, ids)
              await load()
            }}
          />
          <NameForm
            label={`New skill in ${category.category_name}`}
            field="skill_name"
            submitLabel="Add skill"
            onSave={async (name) => {
              await skillsApi.create(name, category.category_id)
              await load()
              setDialogNotice(`Added the skill "${name.trim()}".`)
            }}
          />
        </Collapsible>
        <UsedBy uses={category.used_by} />
        {category.category_id === OTHER_CATEGORY_ID && (
          <p className="muted">Skills no other category lists stay here until you add them to one.</p>
        )}
      </ItemDialog>
    )
  }

  function skillDialog(skill: Skill) {
    return (
      <ItemDialog
        notice={dialogNotice}
        title={skill.skill_name}
        onClose={() => setEditing(null)}
        form={
          <NameForm
            label="Skill name"
            field="skill_name"
            initial={skill.skill_name}
            lockedNote={anyLocked(skill.used_by) ? lockedNote('skill') : undefined}
            onSave={(name) => renameSkill(skill, name)}
            onCancel={() => setEditing(null)}
          />
        }
        newVersion={(back) => (
          <NameForm
            label="New version's name"
            field="skill_name"
            initial={skill.skill_name}
            submitLabel="Add version"
            onSave={(name) => skillVersion(skill, name)}
            onCancel={back}
          />
        )}
        confirmDelete={(back) => (
          <ConfirmDelete
            what={`"${skill.skill_name}"`}
            uses={skill.used_by}
            effect="It's removed from them, and from every category and project."
            error={deleteError}
            onConfirm={() => void remove({ kind: 'skill', id: skill.skill_id }, skill.skill_name)}
            onCancel={back}
          />
        )}
      >
        <NameList title="Categories" names={skill.categories.map((category) => category.category_name)} />
        <NameList title="Projects" names={skill.projects.map(projectLabel)} />
        <UsedBy uses={skill.used_by} />
      </ItemDialog>
    )
  }

  const editingCategory =
    editing?.kind === 'category' ? categories?.find((category) => category.category_id === editing.id) : undefined
  const editingSkill = editing?.kind === 'skill' ? skills.find((skill) => skill.skill_id === editing.id) : undefined

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Skills
      </h2>
      <p className="muted">
        Each category lists the skills the app suggests for it, in this order. A skill can be in more
        than one category, and every skill is in at least one ("Other" if nothing else).
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
      {!categories && !loadError && <p>Loading…</p>}

      {categories && (
        <div className="card">
          <label>
            List the new category under
            <select value={newCategorySection} onChange={(event) => setNewCategorySection(event.target.value)}>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title}
                </option>
              ))}
              <option value="">No section</option>
            </select>
          </label>
          <NameForm
            label="New category name"
            field="category_name"
            submitLabel="Add category"
            onSave={async (name) => {
              await skillCategoriesApi.create(name, newCategorySection ? Number(newCategorySection) : null)
              setNotice(`Added "${name.trim()}".`)
              await load()
            }}
          />
        </div>
      )}

      <h3>Categories</h3>
      {categories?.map((category) => (
        <LibraryCard
          key={category.category_id}
          title={category.category_name}
          tags={category.built_in && <span className="tag">built in</span>}
          editId={editId('category', category.category_id)}
          editLabel={`Edit "${category.category_name}"`}
          onEdit={() => openItem({ kind: 'category', id: category.category_id })}
        >
          <p className="muted">{category.skills.map((skill) => skill.skill_name).join(', ') || 'No skills yet.'}</p>
        </LibraryCard>
      ))}

      {categories && <h3>All skills</h3>}
      {categories && skills.length === 0 && <p>No skills yet.</p>}
      {skills.map((skill) => (
        <LibraryCard
          key={skill.skill_id}
          title={skill.skill_name}
          editId={editId('skill', skill.skill_id)}
          editLabel={`Edit "${skill.skill_name}"`}
          onEdit={() => openItem({ kind: 'skill', id: skill.skill_id })}
        />
      ))}
      {editingCategory && categoryDialog(editingCategory)}
      {editingSkill && skillDialog(editingSkill)}
    </section>
  )
}
