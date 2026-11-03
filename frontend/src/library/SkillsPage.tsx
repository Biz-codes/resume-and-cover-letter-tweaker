// Library page for skill categories and skills: adding both, and each one's dialog (CategoryItem,
// SkillItem), where it's renamed, given a new version, or deleted, with a category's ordered skill
// list. Rules from docs/FRONTEND_CHECKS.md: "Other" is built in, every skill keeps a category, and
// deleting a category moves its skills under "Other".
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { BUILT_IN_SECTION_IDS, sectionsApi, type Section } from '../shared/api/sections'
import { skillCategoriesApi, skillsApi, type Skill, type SkillCategory } from '../shared/api/skills'
import NameForm from '../shared/components/NameForm/NameForm'
import { PAGE_HEADING_ID } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import LibraryCard from './LibraryCard'

export default function SkillsPage() {
  const [categories, setCategories] = useState<SkillCategory[] | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [newCategorySection, setNewCategorySection] = useState(String(BUILT_IN_SECTION_IDS.skills))
  const [notice, setNotice] = useState<string | null>(null)
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

  const dialogs = useItemDialogs({ reload: load, notify: setNotice })

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
              await load()
              setNotice(`Added "${name.trim()}".`)
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
          onEdit={() => dialogs.open({ kind: 'category', id: category.category_id, title: category.category_name })}
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
          onEdit={() => dialogs.open({ kind: 'skill', id: skill.skill_id, title: skill.skill_name })}
        />
      ))}
      {dialogs.dialog}
    </section>
  )
}
