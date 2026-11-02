// Library page for tones: named groups of tone rules (docs/WRITING_RULES.md, "Tone rules"). The
// database and API call a tone a tone set (tone_set); the app says "tone".
// Add sets, and open each one's dialog (ItemDialog) to rename it, add a version of it (with a copy
// of its rules), delete it, and add, edit, reorder, and delete its rules. A resume or
// cover letter can use one set. Tone rules only steer suggestions and are never printed, so
// edits are always made in place, even when a sent version uses the set.
import { useCallback, useEffect, useState } from 'react'
import { shortBullet } from '../shared/api/bullets'
import { toApiError, type ApiError } from '../shared/api/client'
import { toneSetsApi, type ToneSet } from '../shared/api/toneSets'
import Collapsible from './Collapsible/Collapsible'
import ConfirmDelete from '../shared/components/ConfirmDelete'
import NameForm from '../shared/components/NameForm/NameForm'
import ItemDialog from './ItemDialog'
import LibraryCard from './LibraryCard'
import OrderedList from '../shared/components/OrderedList/OrderedList'
import UsedBy from './UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'

// What's open on a rule in a tone's dialog: editing or deleting it.
type RuleOpen = { kind: 'edit' | 'delete'; ruleId: number }

// Ids where focus goes back to: a tone's Edit button, a rule's buttons, and the dialog's heading.
const editId = (id: number) => `tone-set-${id}-edit`
const ruleButtonId = (id: number, action: 'edit' | 'delete') => `tone-rule-${id}-${action}`
const DIALOG_HEADING_ID = 'tone-dialog-heading'

const ruleLabel = (text: string) => `"${shortBullet(text)}"`

export default function ToneSetsPage() {
  const [sets, setSets] = useState<ToneSet[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  // The tone whose dialog is open, and what's open on one of its rules.
  const [editing, setEditing] = useState<number | null>(null)
  const [ruleOpen, setRuleOpen] = useState<RuleOpen | null>(null)
  // Said in the dialog, which stays open while its rules change.
  const [ruleNotice, setRuleNotice] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
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

  function openItem(id: number) {
    setEditing(id)
    setRuleOpen(null)
    setRuleNotice(null)
    setDeleteError(null)
    setNotice(null)
  }

  function showRule(next: RuleOpen | null) {
    setRuleOpen(next)
    setDeleteError(null)
    if (next) setRuleNotice(null)
  }

  async function create(name: string) {
    await toneSetsApi.create(name)
    setNotice(`Added "${name.trim()}".`)
    await load()
  }

  async function rename(toneSet: ToneSet, name: string) {
    await toneSetsApi.rename(toneSet.tone_set_id, name)
    setEditing(null)
    await load()
    setNotice('Saved.')
    focusLater(editId(toneSet.tone_set_id))
  }

  async function addVersion(toneSet: ToneSet, name: string) {
    const version = await toneSetsApi.addVersion(toneSet.tone_set_id, name)
    setEditing(null)
    await load()
    setNotice(`Added "${version.name}", with a copy of each rule. Resumes and cover letters keep "${toneSet.name}" until you pick the new one.`)
    focusLater(editId(version.tone_set_id))
  }

  async function deleteSet(toneSet: ToneSet) {
    setDeleteError(null)
    try {
      await toneSetsApi.delete(toneSet.tone_set_id)
      setEditing(null)
      focusLater(PAGE_HEADING_ID)
      await load()
      setNotice(`Deleted "${toneSet.name}" and its rules.`)
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  // A rule is part of its tone, so it's changed in the tone's dialog, which stays open.
  async function saveRule(toneSet: ToneSet, ruleId: number, text: string) {
    await toneSetsApi.updateRule(toneSet.tone_set_id, ruleId, text)
    showRule(null)
    await load()
    setRuleNotice(`Saved the rule ${ruleLabel(text.trim())}.`)
    focusLater(ruleButtonId(ruleId, 'edit'))
  }

  async function deleteRule(toneSet: ToneSet, ruleId: number, text: string) {
    setDeleteError(null)
    try {
      await toneSetsApi.deleteRule(toneSet.tone_set_id, ruleId)
      showRule(null)
      await load()
      setRuleNotice(`Deleted the rule ${ruleLabel(text)}.`)
      focusLater(DIALOG_HEADING_ID)
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  function itemDialog(toneSet: ToneSet) {
    const id = toneSet.tone_set_id
    const rule = ruleOpen && toneSet.rules.find((r) => r.tone_rule_id === ruleOpen.ruleId)
    return (
      <ItemDialog
        title={toneSet.name}
        headingId={DIALOG_HEADING_ID}
        notice={ruleNotice}
        onClose={() => setEditing(null)}
        form={
          <NameForm
            label="Tone name"
            field="name"
            initial={toneSet.name}
            onSave={(text) => rename(toneSet, text)}
            onCancel={() => setEditing(null)}
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
              await load()
            }}
          />
          {ruleOpen?.kind === 'edit' && rule && (
            <NameForm
              key={rule.tone_rule_id}
              label={`Edit rule ${ruleLabel(rule.rule_text)}`}
              field="rule_text"
              initial={rule.rule_text}
              multiline
              onSave={(text) => saveRule(toneSet, rule.tone_rule_id, text)}
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
              onConfirm={() => void deleteRule(toneSet, rule.tone_rule_id, rule.rule_text)}
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
              await load()
              setRuleNotice(`Added the rule ${ruleLabel(text.trim())}.`)
            }}
          />
        </Collapsible>

        <UsedBy uses={toneSet.used_by} />
      </ItemDialog>
    )
  }

  const editingSet = sets?.find((toneSet) => toneSet.tone_set_id === editing)

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
          editId={editId(toneSet.tone_set_id)}
          editLabel={`Edit "${toneSet.name}"`}
          onEdit={() => openItem(toneSet.tone_set_id)}
        >
          <p className="muted">{toneSet.rules.length === 1 ? '1 rule' : `${toneSet.rules.length} rules`}</p>
        </LibraryCard>
      ))}
      {editingSet && itemDialog(editingSet)}
    </section>
  )
}
