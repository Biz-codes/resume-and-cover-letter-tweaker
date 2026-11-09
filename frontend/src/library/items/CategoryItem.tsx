// A skill category's dialog: rename it (following "Changing an item" in docs/FRONTEND_CHECKS.md),
// delete it (its skills move under "Other"; docs/FRONTEND_CHECKS.md, "Deleting a skill category"),
// and edit its ordered skill list. Its skills and sections open in the same dialog. "Other" can't
// be hidden or deleted, and a new name for it saves a new category.
import { useState } from 'react'
import { toApiError, type ApiError } from '../../shared/api/client'
import { OTHER_CATEGORY_ID, skillCategoriesApi, skillsApi, type SkillCategory } from '../../shared/api/skills'
import { anyLocked, type Use } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import NameForm from '../../shared/components/NameForm/NameForm'
import OrderedList from '../../shared/components/OrderedList/OrderedList'
import ApplyChoice from '../ApplyChoice'
import { changeNote, inProgressUses, pickedFor, savedMessage } from '../applyChange'
import Collapsible from '../Collapsible/Collapsible'
import NameList from '../NameList'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'
import { lockedNote } from './itemFields'
import { offered } from '../../shared/offered'


const BUILT_IN_NOTE = '"Other" is built in and keeps its name, so saving adds a new category.'

export default function CategoryItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => Promise.all([skillCategoriesApi.list(), skillsApi.list()]))
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const category = data?.[0].find((item) => item.category_id === id)
  if (!data || !category) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const skills = data[1]
  const { here, others, elsewhere } = inProgressUses(category.used_by, host.placed?.where)
  const sentNote = anyLocked(category.used_by) ? lockedNote('category') : undefined

  async function refresh() {
    await Promise.all([load(), host.refresh()])
  }

  async function rename(original: SkillCategory, name: string) {
    const saved = await skillCategoriesApi.rename(original.category_id, name, pickedFor(here, applyTo))
    const message = savedMessage({
      newVersion: saved.category_id !== original.category_id,
      before: original.category_name,
      after: saved.category_name,
      here,
      doc: host.placed?.doc,
      checked: applyTo,
    })
    await host.saved(message, { kind: 'category', id: saved.category_id })
  }


  async function confirmDelete(original: SkillCategory) {
    setDeleteError(null)
    try {
      await skillCategoriesApi.delete(original.category_id)
      await host.deleted(`Deleted "${original.category_name}".`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      name={`"${category.category_name}"`}
      hidden={category.hidden}
      usedBySent={anyLocked(category.used_by)}
      onSetHidden={category.built_in ? undefined : async (next) => {
        await skillCategoriesApi.setHidden(category.category_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <NameForm
          label="Category name"
          field="category_name"
          initial={category.category_name}
          lockedNote={changeNote(here, others, host.placed?.doc, category.built_in ? BUILT_IN_NOTE : sentNote, category.built_in || elsewhere)}
          onSave={(name) => rename(category, name)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          {others.length > 0 && <ApplyChoice uses={others} others={Boolean(here)} applyTo={applyTo} onChange={setApplyTo} />}
        </NameForm>
      }
      confirmDelete={
        category.built_in
          ? undefined
          : (back) => (
              <ConfirmDelete
                what={`"${category.category_name}"`}
                uses={category.used_by}
                effect='They keep showing its skills, under "Other".'
                error={deleteError}
                onConfirm={() => void confirmDelete(category)}
                onCancel={back}
              />
            )
      }
    >
      {category.built_in ? (
        <p className="muted">Offered wherever skills are added.</p>
      ) : (
        <NameList
          title="Sections that list it"
          refs={category.sections.map((section) => ({ kind: 'section', id: section.id, title: section.title }))}
        />
      )}

      <Collapsible title="Skills" count={category.skills.length}>
        <OrderedList
          label={`${category.category_name} skills`}
          items={category.skills.map((skill) => ({ id: skill.skill_id, name: skill.skill_name }))}
          choices={offered(skills).map((skill) => ({ id: skill.skill_id, name: skill.skill_name }))}
          emptyText="No skills yet."
          onOpen={(item) => host.open({ kind: 'skill', id: item.id, title: item.name })}
          onChange={async (ids) => {
            await skillCategoriesApi.setSkills(category.category_id, ids)
            await refresh()
          }}
        />
        <NameForm
          label={`New skill in ${category.category_name}`}
          field="skill_name"
          submitLabel="Add skill"
          onSave={async (name) => {
            await skillsApi.create(name, category.category_id)
            await refresh()
            host.say(`Added the skill "${name.trim()}".`)
          }}
        />
      </Collapsible>
      <UsedBy uses={category.used_by} />
      {category.category_id === OTHER_CATEGORY_ID && (
        <p className="muted">Skills no other category lists stay here until you add them to one.</p>
      )}
    </ItemParts>
  )
}
