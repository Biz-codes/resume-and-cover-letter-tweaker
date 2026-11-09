// A tone's dialog: edit it, or delete it. A tone is saved whole: its name and its rules, which are
// added, edited, reordered, and removed in the form, each change announced (the list says its own),
// and saved together with Save. Saving follows "Changing an item" in docs/FRONTEND_CHECKS.md, so a sent
// version keeps the tone it was written with, and resumes and cover letters in progress change only
// if the user picks them. A tone saved from an edit keeps its name; lists tell the two apart by when
// each was added.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { toneSetsApi, type ToneSet } from '../../shared/api/toneSets'
import { anyLocked, type Use } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import OrderedList from '../../shared/components/OrderedList/OrderedList'
import { useFocusLater } from '../../shared/hooks/useFocusLater'
import ApplyChoice from '../ApplyChoice'
import { changeNote, inProgressUses, savedMessage } from '../applyChange'
import Collapsible from '../Collapsible/Collapsible'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import { toneLabels } from './itemFields'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'

const SENT_NOTE = 'A sent version uses this tone, so saving adds a new one. The sent version keeps this one.'

// A rule in the form. Rules not saved yet have negative ids, which are sent as none.
interface Rule {
  id: number
  text: string
}

const ruleButtonId = (id: number) => `tone-rule-${id}-edit`
const ruleLabel = (text: string) => `"${shortBullet(text)}"`

export default function ToneItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => toneSetsApi.list())
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const toneSet = data?.find((item) => item.tone_set_id === id)
  if (!data || !toneSet) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const label = toneLabels(data)(toneSet)

  async function deleteSet(original: ToneSet) {
    setDeleteError(null)
    try {
      await toneSetsApi.delete(original.tone_set_id)
      await host.deleted(`Deleted "${label}" and its rules.`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      name={`"${label}"`}
      hidden={toneSet.hidden}
      usedBySent={anyLocked(toneSet.used_by)}
      onSetHidden={async (next) => {
        await toneSetsApi.setHidden(toneSet.tone_set_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={<ToneForm toneSet={toneSet} all={data} />}
      confirmDelete={(back) => (
        <ConfirmDelete
          what={`"${label}"`}
          uses={toneSet.used_by}
          effect="They keep going with no tone."
          error={deleteError}
          onConfirm={() => void deleteSet(toneSet)}
          onCancel={back}
        />
      )}
    >
      <UsedBy uses={toneSet.used_by} />
    </ItemParts>
  )
}

// The tone's name and rules, saved together. Its buttons for rules don't submit it; only Save (or
// Enter in the name) does.
function ToneForm({ toneSet, all }: { toneSet: ToneSet; all: ToneSet[] }) {
  const host = useItemHost()
  const [name, setName] = useState(toneSet.name)
  const [rules, setRules] = useState<Rule[]>(() => toneSet.rules.map((rule) => ({ id: rule.tone_rule_id, text: rule.rule_text })))
  // The rule being edited, and its text so far.
  const [editing, setEditing] = useState<Rule | null>(null)
  const [newRule, setNewRule] = useState('')
  const [nextId, setNextId] = useState(-1)
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const focusLater = useFocusLater()
  const id = useId()
  const noteId = `${id}-note`
  const errorId = `${id}-error`
  const { here, others, elsewhere } = inProgressUses(toneSet.used_by, host.placed?.where)
  const note = changeNote(here, others, host.placed?.doc, anyLocked(toneSet.used_by) ? SENT_NOTE : undefined, elsewhere)

  function addRule() {
    const text = newRule.trim()
    if (!text) return
    setRules([...rules, { id: nextId, text }])
    setNextId(nextId - 1)
    setNewRule('')
    host.say(`Added the rule ${ruleLabel(text)}.`)
  }

  function applyEdit() {
    if (!editing) return
    const text = editing.text.trim()
    if (!text) return
    setRules(rules.map((rule) => (rule.id === editing.id ? { ...rule, text } : rule)))
    setEditing(null)
    host.say(`Changed the rule to ${ruleLabel(text)}.`)
    focusLater(ruleButtonId(editing.id))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const saved = await toneSetsApi.update(
        toneSet.tone_set_id,
        name,
        rules.map((rule) => ({ tone_rule_id: rule.id > 0 ? rule.id : null, rule_text: rule.text })),
        applyTo,
      )
      await host.saved(
        savedMessage({
          newVersion: saved.tone_set_id !== toneSet.tone_set_id,
          before: toneLabels(all)(toneSet),
          after: toneLabels([...all, saved])(saved),
          here,
          doc: host.placed?.doc,
          checked: applyTo,
        }),
        { kind: 'tone', id: saved.tone_set_id },
      )
    } catch (caught) {
      setError(toApiError(caught))
      setSaving(false)
    }
  }

  const describedBy = [note && noteId, error?.field === 'name' && errorId].filter(Boolean).join(' ') || undefined

  return (
    <form className="card" onSubmit={submit} aria-label={`Edit "${toneLabels(all)(toneSet)}"`}>
      {note && (
        <p className="note" id={noteId}>
          {note}
        </p>
      )}
      <label>
        Tone name
        <input
          value={name}
          aria-required="true"
          aria-invalid={error?.field === 'name'}
          aria-describedby={describedBy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <Collapsible title="Rules" count={rules.length}>
        <OrderedList
          label={`${toneSet.name} rules`}
          items={rules.map((rule) => ({ id: rule.id, name: rule.text, label: ruleLabel(rule.text) }))}
          choices={[]}
          emptyText="No rules yet."
          actions={(item) => {
            const rule = rules.find((other) => other.id === item.id)
            return (
              rule && (
                <button
                  type="button"
                  id={ruleButtonId(rule.id)}
                  aria-label={`Edit ${item.label}`}
                  onClick={() => {
                    setEditing(rule)
                    host.say('')
                  }}
                >
                  Edit
                </button>
              )
            )
          }}
          // Reordered or removed, in the form only.
          onChange={async (ids) => {
            setRules(ids.map((ruleId) => rules.find((rule) => rule.id === ruleId)).filter((rule): rule is Rule => Boolean(rule)))
            if (editing && !ids.includes(editing.id)) setEditing(null)
          }}
        />
        {editing && (
          <RuleEditor
            key={editing.id}
            label={`Edit rule ${ruleLabel(rules.find((rule) => rule.id === editing.id)?.text ?? editing.text)}`}
            text={editing.text}
            applyLabel="Apply"
            applyName={`Apply edit to ${ruleLabel(rules.find((rule) => rule.id === editing.id)?.text ?? editing.text)}`}
            focus
            onText={(text) => setEditing({ ...editing, text })}
            onApply={applyEdit}
            onCancel={{
              label: `Cancel editing ${ruleLabel(rules.find((rule) => rule.id === editing.id)?.text ?? editing.text)}`,
              run: () => {
                setEditing(null)
                focusLater(ruleButtonId(editing.id))
              },
            }}
          />
        )}
        <RuleEditor label={`New rule for ${toneSet.name}`} text={newRule} applyLabel="Add rule" onText={setNewRule} onApply={addRule} />
      </Collapsible>
      {others.length > 0 && <ApplyChoice uses={others} others={Boolean(here)} applyTo={applyTo} onChange={setApplyTo} />}
      {error && (
        <p role="alert" id={errorId}>
          {error.message}
        </p>
      )}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="submit" aria-disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={host.close}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// A rule's text, inside the tone's form, so it has no form of its own: its button puts the text in
// the list. An empty rule says so instead.
function RuleEditor({
  label,
  text,
  applyLabel,
  applyName,
  focus = false,
  onText,
  onApply,
  onCancel,
}: {
  label: string
  text: string
  applyLabel: string
  // The button's name when it needs its rule in it, starting with applyLabel (WCAG 2.5.3).
  applyName?: string
  // Takes focus when it opens (editing a rule).
  focus?: boolean
  onText: (text: string) => void
  onApply: () => void
  // Named for the rule (`Cancel editing "Lead with tools."`), apart from the tone's own Cancel.
  onCancel?: { label: string; run: () => void }
}) {
  const [empty, setEmpty] = useState(false)
  const errorId = useId()
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (focus) textRef.current?.focus()
  }, [focus])

  return (
    <div className="stacked-form">
      <label>
        {label}
        <textarea
          ref={textRef}
          rows={3}
          value={text}
          aria-invalid={empty}
          aria-describedby={empty ? errorId : undefined}
          onChange={(event) => {
            setEmpty(false)
            onText(event.target.value)
          }}
        />
      </label>
      {empty && (
        <p role="alert" id={errorId}>
          Type the rule.
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          aria-label={applyName}
          onClick={() => {
            if (!text.trim()) setEmpty(true)
            else onApply()
          }}
        >
          {applyLabel}
        </button>
        {onCancel && (
          <button type="button" aria-label={onCancel.label} onClick={onCancel.run}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
