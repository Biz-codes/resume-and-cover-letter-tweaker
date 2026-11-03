// A tone's dialog: rename it, add a version of it (with a copy of its rules), delete it, and add,
// edit, reorder, and delete its rules. Tone rules only steer suggestions and are never printed,
// so edits are always made in place. A rule is part of its tone, so it's changed here, and the
// dialog stays open, saying what changed in its own notice.
import { useState } from 'react'
import { shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { toneSetsApi, type ToneSet } from '../../shared/api/toneSets'
import { anyLocked } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import NameForm from '../../shared/components/NameForm/NameForm'
import OrderedList from '../../shared/components/OrderedList/OrderedList'
import { useFocusLater } from '../../shared/hooks/useFocusLater'
import Collapsible from '../Collapsible/Collapsible'
import UsedBy from '../UsedBy'
import { DIALOG_HEADING_ID, useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'

// What's open on a rule: editing or deleting it.
type RuleOpen = { kind: 'edit' | 'delete'; ruleId: number }

const ruleButtonId = (id: number, action: 'edit' | 'delete') => `tone-rule-${id}-${action}`
const ruleLabel = (text: string) => `"${shortBullet(text)}"`

export default function ToneItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => toneSetsApi.list())
  const [ruleOpen, setRuleOpen] = useState<RuleOpen | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const focusLater = useFocusLater()

  const toneSet = data?.find((item) => item.tone_set_id === id)
  if (!data || !toneSet) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const rule = ruleOpen && toneSet.rules.find((r) => r.tone_rule_id === ruleOpen.ruleId)

  async function refresh() {
    await Promise.all([load(), host.refresh()])
  }

  function showRule(next: RuleOpen | null) {
    setRuleOpen(next)
    setDeleteError(null)
    if (next) host.say('')
  }

  async function rename(original: ToneSet, name: string) {
    await toneSetsApi.rename(original.tone_set_id, name)
    await host.saved('Saved.', { kind: 'tone', id: original.tone_set_id })
  }

  async function addVersion(original: ToneSet, name: string) {
    const version = await toneSetsApi.addVersion(original.tone_set_id, name)
    await host.saved(
      `Added "${version.name}", with a copy of each rule. Resumes and cover letters keep "${original.name}" until you pick the new one.`,
      { kind: 'tone', id: version.tone_set_id },
    )
  }

  async function deleteSet(original: ToneSet) {
    setDeleteError(null)
    try {
      await toneSetsApi.delete(original.tone_set_id)
      await host.deleted(`Deleted "${original.name}" and its rules.`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  async function saveRule(ruleId: number, text: string) {
    await toneSetsApi.updateRule(id, ruleId, text)
    showRule(null)
    await refresh()
    host.say(`Saved the rule ${ruleLabel(text.trim())}.`)
    focusLater(ruleButtonId(ruleId, 'edit'))
  }

  async function deleteRule(ruleId: number, text: string) {
    setDeleteError(null)
    try {
      await toneSetsApi.deleteRule(id, ruleId)
      showRule(null)
      await refresh()
      host.say(`Deleted the rule ${ruleLabel(text)}.`)
      focusLater(DIALOG_HEADING_ID)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      hidden={toneSet.hidden}
      usedBySent={anyLocked(toneSet.used_by)}
      onSetHidden={async (next) => {
        await toneSetsApi.setHidden(toneSet.tone_set_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <NameForm
          label="Tone name"
          field="name"
          initial={toneSet.name}
          onSave={(text) => rename(toneSet, text)}
          focusOnOpen={false}
          onCancel={host.close}
        />
      }
      newVersion={(back) => (
        <NameForm
          label="New version's name"
          field="name"
          initial={toneSet.name}
          submitLabel="Add version"
          onSave={(text) => addVersion(toneSet, text)}
          onCancel={back}
        />
      )}
      confirmDelete={(back) => (
        <ConfirmDelete
          what={`"${toneSet.name}"`}
          uses={toneSet.used_by}
          effect="They keep going with no tone."
          error={deleteError}
          onConfirm={() => void deleteSet(toneSet)}
          onCancel={back}
        />
      )}
    >
      <Collapsible title="Rules" count={toneSet.rules.length}>
        <OrderedList
          label={`${toneSet.name} rules`}
          items={toneSet.rules.map((r) => ({ id: r.tone_rule_id, name: r.rule_text, label: ruleLabel(r.rule_text) }))}
          choices={[]}
          emptyText="No rules yet."
          removable={false}
          actions={(item) => (
            <>
              <button
                type="button"
                id={ruleButtonId(item.id, 'edit')}
                aria-label={`Edit ${item.label}`}
                onClick={() => showRule({ kind: 'edit', ruleId: item.id })}
              >
                Edit
              </button>
              <button
                type="button"
                id={ruleButtonId(item.id, 'delete')}
                aria-label={`Delete ${item.label}`}
                onClick={() => showRule({ kind: 'delete', ruleId: item.id })}
              >
                Delete
              </button>
            </>
          )}
          onChange={async (ids) => {
            await toneSetsApi.orderRules(id, ids)
            await refresh()
          }}
        />
        {ruleOpen?.kind === 'edit' && rule && (
          <NameForm
            key={rule.tone_rule_id}
            label={`Edit rule ${ruleLabel(rule.rule_text)}`}
            field="rule_text"
            initial={rule.rule_text}
            multiline
            onSave={(text) => saveRule(rule.tone_rule_id, text)}
            onCancel={() => {
              showRule(null)
              focusLater(ruleButtonId(rule.tone_rule_id, 'edit'))
            }}
          />
        )}
        {ruleOpen?.kind === 'delete' && rule && (
          <ConfirmDelete
            what={`the rule ${ruleLabel(rule.rule_text)}`}
            uses={[]}
            effect={null}
            error={deleteError}
            onConfirm={() => void deleteRule(rule.tone_rule_id, rule.rule_text)}
            onCancel={() => {
              showRule(null)
              focusLater(ruleButtonId(rule.tone_rule_id, 'delete'))
            }}
          />
        )}
        <NameForm
          label={`New rule for ${toneSet.name}`}
          field="rule_text"
          submitLabel="Add rule"
          multiline
          onSave={async (text) => {
            await toneSetsApi.addRule(id, text)
            await refresh()
            host.say(`Added the rule ${ruleLabel(text.trim())}.`)
          }}
        />
      </Collapsible>

      <UsedBy uses={toneSet.used_by} />
    </ItemParts>
  )
}
