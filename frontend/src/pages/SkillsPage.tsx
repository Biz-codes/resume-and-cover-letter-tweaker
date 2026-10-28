// Library page for skill categories and skills: each category's ordered skill list, adding,
// renaming, and deleting both. Rules from docs/FRONTEND_CHECKS.md: "Other" is built in,
// every skill keeps a category, and deleting a category moves its skills under "Other".
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../api/client'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../api/sections'
import { OTHER_CATEGORY_ID, skillCategoriesApi, skillsApi, type Skill, type SkillCategory } from '../api/skills'
import { anyLocked } from '../api/usage'
import Collapsible from '../components/Collapsible'
import ConfirmDelete from '../components/ConfirmDelete'
import NameForm from '../components/NameForm'
import OrderedList from '../components/OrderedList'
import UsedBy from '../components/UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

const lockedNote = (what: string) =>
  `A sent version uses this ${what}, so the new name will be saved as a new ${what}. Sent versions keep the old name; unsent ones switch to the new one.`

type Target = { kind: 'category' | 'skill'; id: number }

// Ids of each card's Rename and Delete buttons, where focus returns when a form closes.
const buttonId = (kind: Target['kind'], id: number, action: 'rename' | 'delete') => `${kind}-${id}-${action}`

function projectLabel(project: Skill['projects'][number]) {
  return project.done_for ? `${project.project_title} (${project.done_for})` : project.project_title
}

function NameList({ title, names }: { title: string; names: string[] }) {
  return (
    <Collapsible title={title} count={names.length}>
      {names.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="uses">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </Collapsible>
  )
}

export default function SkillsPage() {
  const [categories, setCategories] = useState<SkillCategory[] | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [newCategorySection, setNewCategorySection] = useState(String(BUILT_IN_SECTION_IDS.skills))
  const [renaming, setRenaming] = useState<Target | null>(null)
  const [deleting, setDeleting] = useState<Target | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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
  const is = (target: Target | null, kind: Target['kind'], id: number) => target?.kind === kind && target.id === id

  function closeForm(target: Target, action: 'rename' | 'delete') {
    if (action === 'rename') setRenaming(null)
    else setDeleting(null)
    focusLater(buttonId(target.kind, target.id, action))
  }

  function startDeleting(target: Target) {
    setDeleting(target)
    setDeleteError(null)
    setRenaming(null)
  }

  async function remove(target: Target, name: string) {
    setDeleteError(null)
    try {
      await (target.kind === 'category' ? skillCategoriesApi.delete(target.id) : skillsApi.delete(target.id))
      setDeleting(null)
      focusLater(PAGE_HEADING_ID)
      setNotice(`Deleted "${name}".`)
      await load()
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  async function renameCategory(category: SkillCategory, name: string) {
    const saved = await skillCategoriesApi.rename(category.category_id, name)
    setRenaming(null)
    focusLater(buttonId('category', saved.category_id, 'rename'))
    setNotice(
      saved.category_id === category.category_id
        ? 'Saved.'
        : `Saved as a new category, "${saved.category_name}". Sent versions keep "${category.category_name}".`,
    )
    await load()
  }

  async function renameSkill(skill: Skill, name: string) {
    const saved = await skillsApi.rename(skill.skill_id, name)
    setRenaming(null)
    focusLater(buttonId('skill', saved.skill_id, 'rename'))
    setNotice(
      saved.skill_id === skill.skill_id
        ? 'Saved.'
        : `Saved as a new skill, "${saved.skill_name}". Sent versions keep "${skill.skill_name}".`,
    )
    await load()
  }

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
        <article key={category.category_id} className="card">
          {is(renaming, 'category', category.category_id) ? (
            <NameForm
              label="Category name"
              field="category_name"
              initial={category.category_name}
              lockedNote={anyLocked(category.used_by) ? lockedNote('category') : undefined}
              onSave={(name) => renameCategory(category, name)}
              onCancel={() => closeForm({ kind: 'category', id: category.category_id }, 'rename')}
            />
          ) : (
            <h4>
              {category.category_name}
              {category.built_in && <span className="tag">built in</span>}
            </h4>
          )}
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
              }}
            />
          </Collapsible>
          <UsedBy uses={category.used_by} />

          {!category.built_in &&
            !is(renaming, 'category', category.category_id) &&
            (is(deleting, 'category', category.category_id) ? (
              <ConfirmDelete
                what={`"${category.category_name}"`}
                uses={category.used_by}
                effect='They keep showing its skills, under "Other".'
                error={deleteError}
                onConfirm={() => void remove({ kind: 'category', id: category.category_id }, category.category_name)}
                onCancel={() => closeForm({ kind: 'category', id: category.category_id }, 'delete')}
              />
            ) : (
              <div className="actions">
                <button
                  type="button"
                  id={buttonId('category', category.category_id, 'rename')}
                  aria-label={`Rename "${category.category_name}"`}
                  onClick={() => setRenaming({ kind: 'category', id: category.category_id })}
                >
                  Rename
                </button>
                <button
                  type="button"
                  id={buttonId('category', category.category_id, 'delete')}
                  aria-label={`Delete "${category.category_name}"`}
                  onClick={() => startDeleting({ kind: 'category', id: category.category_id })}
                >
                  Delete
                </button>
              </div>
            ))}
          {category.category_id === OTHER_CATEGORY_ID && (
            <p className="muted">Skills no other category lists stay here until you add them to one.</p>
          )}
        </article>
      ))}

      {categories && <h3>All skills</h3>}
      {categories && skills.length === 0 && <p>No skills yet.</p>}
      {skills.map((skill) => (
        <article key={skill.skill_id} className="card">
          {is(renaming, 'skill', skill.skill_id) ? (
            <NameForm
              label="Skill name"
              field="skill_name"
              initial={skill.skill_name}
              lockedNote={anyLocked(skill.used_by) ? lockedNote('skill') : undefined}
              onSave={(name) => renameSkill(skill, name)}
              onCancel={() => closeForm({ kind: 'skill', id: skill.skill_id }, 'rename')}
            />
          ) : (
            <h4>{skill.skill_name}</h4>
          )}
          <NameList title="Categories" names={skill.categories.map((category) => category.category_name)} />
          <NameList title="Projects" names={skill.projects.map(projectLabel)} />
          <UsedBy uses={skill.used_by} />
          {!is(renaming, 'skill', skill.skill_id) &&
            (is(deleting, 'skill', skill.skill_id) ? (
              <ConfirmDelete
                what={`"${skill.skill_name}"`}
                uses={skill.used_by}
                effect="It's removed from them, and from every category and project."
                error={deleteError}
                onConfirm={() => void remove({ kind: 'skill', id: skill.skill_id }, skill.skill_name)}
                onCancel={() => closeForm({ kind: 'skill', id: skill.skill_id }, 'delete')}
              />
            ) : (
              <div className="actions">
                <button
                  type="button"
                  id={buttonId('skill', skill.skill_id, 'rename')}
                  aria-label={`Rename "${skill.skill_name}"`}
                  onClick={() => setRenaming({ kind: 'skill', id: skill.skill_id })}
                >
                  Rename
                </button>
                <button
                  type="button"
                  id={buttonId('skill', skill.skill_id, 'delete')}
                  aria-label={`Delete "${skill.skill_name}"`}
                  onClick={() => startDeleting({ kind: 'skill', id: skill.skill_id })}
                >
                  Delete
                </button>
              </div>
            ))}
        </article>
      ))}
    </section>
  )
}
