// A tone's dialog: edit it, or delete it. A tone is saved whole: its name and its list of rules,
// where saved rules are added (from the library's tone rules, which a tone shares with others) and
// new ones written, reordered, and removed in the form, each change announced (the list says its
// own), and saved together with Save. A rule's own text is edited in its dialog (ToneRuleItem),
// from the Tones page. Saving follows "Changing an item" in docs/FRONTEND_CHECKS.md, so a sent
// version keeps the tone it was written with, and resumes and cover letters in progress change only
// if the user picks them. Tone names are unique, so when saving adds a new tone, the form asks what
// to call the earlier one (which the rest keep), starting from "[name] (earlier)".
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { toneRulesApi } from '../../shared/api/toneRules'
import { savesNewTone, toneSetsApi, type ToneSet } from '../../shared/api/toneSets'
import { anyLocked, type Use } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import OrderedList from '../../shared/components/OrderedList/OrderedList'
import { offered } from '../../shared/offered'
import ApplyChoice from '../ApplyChoice'
import { changeNote, inProgressUses, pickedFor, savedMessage } from '../applyChange'
import Collapsible from '../Collapsible/Collapsible'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'

const SENT_NOTE = 'A sent version uses this tone, so saving adds a new one. The sent version keeps this one.'

// A rule in the form: a saved one by its id, or new text, which has a negative id until it's saved.
interface Rule {
  id: number
  text: string
}

const ruleLabel = (text: string) => `"${shortBullet(text)}"`

export default function ToneItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => Promise.all([toneSetsApi.list(), toneRulesApi.list()]))
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const toneSet = data?.[0].find((item) => item.tone_set_id === id)
  if (!data || !toneSet) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const label = toneSet.name

  async function deleteSet(original: ToneSet) {
    setDeleteError(null)
    try {
      await toneSetsApi.delete(original.tone_set_id)
      await host.deleted(`Deleted "${label}". Its rules stay in your library.`)
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
      form={<ToneForm toneSet={toneSet} saved={data[1].map((rule) => ({ id: rule.tone_rule_id, text: rule.rule_text, hidden: rule.hidden }))} />}
      confirmDelete={(back) => (
        <ConfirmDelete
          what={`"${label}"`}
          uses={toneSet.used_by}
          effect="They keep going with no tone. Its rules stay in your library."
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
// Enter in a name) does.
function ToneForm({ toneSet, saved }: { toneSet: ToneSet; saved: (Rule & { hidden: boolean })[] }) {
  const host = useItemHost()
  const [name, setName] = useState(toneSet.name)
  const [rules, setRules] = useState<Rule[]>(() => toneSet.rules.map((rule) => ({ id: rule.tone_rule_id, text: rule.rule_text })))
  const [newRule, setNewRule] = useState('')
  const [nextId, setNextId] = useState(-1)
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [earlierName, setEarlierName] = useState(`${toneSet.name} (earlier)`)
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const id = useId()
  const noteId = `${id}-note`
  const errorId = `${id}-error`
  const earlierNoteId = `${id}-earlier-note`
  const { here, others, elsewhere } = inProgressUses(toneSet.used_by, host.placed?.where)
  const note = changeNote(here, others, host.placed?.doc, anyLocked(toneSet.used_by) ? SENT_NOTE : undefined, elsewhere)
  const picked = pickedFor(here, applyTo)
  const splits = savesNewTone(toneSet.used_by, picked)
  // Checking or unchecking one in progress can show or take away the earlier name's field, so it's said.
  const wasSplit = useRef(splits)
  useEffect(() => {
    if (wasSplit.current === splits) return
    wasSplit.current = splits
    host.say(splits ? 'Saving adds a new tone. Name the earlier version below.' : 'Saving changes this tone where it is, so no earlier name is needed.')
  })

  function addRule() {
    const text = newRule.trim()
    if (!text) return
    const same = (other: Rule) => other.text.split(/\s+/).join(' ').toLowerCase() === text.split(/\s+/).join(' ').toLowerCase()
    if (rules.some(same)) {
      host.say(`This tone already has the rule ${ruleLabel(text)}.`)
      return
    }
    // A saved rule with the same text is that rule.
    const match = saved.find(same)
    setRules([...rules, match ? { id: match.id, text: match.text } : { id: nextId, text }])
    if (!match) setNextId(nextId - 1)
    setNewRule('')
    host.say(match ? `Added your saved rule ${ruleLabel(match.text)}.` : `Added the rule ${ruleLabel(text)}.`)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const result = await toneSetsApi.update(
        toneSet.tone_set_id,
        name,
        rules.map((rule) => (rule.id > 0 ? { tone_rule_id: rule.id } : { rule_text: rule.text })),
        picked,
        splits ? earlierName : undefined,
      )
      const newVersion = result.tone_set_id !== toneSet.tone_set_id
      // A new tone takes the name, and the rest keep the original under its earlier name.
      const before = newVersion ? earlierName.trim() : toneSet.name
      await host.saved(savedMessage({ newVersion, before, after: result.name, here, doc: host.placed?.doc, checked: applyTo }), {
        kind: 'tone',
        id: result.tone_set_id,
      })
    } catch (caught) {
      setError(toApiError(caught))
      setSaving(false)
    }
  }

  const fieldError = (field: string) => (error?.field === field ? errorId : undefined)
  const describedBy = [note && noteId, fieldError('name')].filter(Boolean).join(' ') || undefined
  const listed = new Set(rules.map((rule) => rule.id))

  return (
    <form className="card" onSubmit={submit} aria-label={`Edit "${toneSet.name}"`}>
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
          // Saved rules not hidden (a hidden one the tone lists stays), offered to add.
          choices={offered(saved)
            .filter((rule) => !listed.has(rule.id))
            .map((rule) => ({ id: rule.id, name: rule.text, label: ruleLabel(rule.text) }))}
          emptyText="No rules yet."
          // Reordered, removed, or a saved rule added, in the form only.
          onChange={async (ids) => {
            setRules(
              ids
                .map((ruleId) => rules.find((rule) => rule.id === ruleId) ?? saved.find((rule) => rule.id === ruleId))
                .filter((rule): rule is Rule => Boolean(rule))
                .map((rule) => ({ id: rule.id, text: rule.text })),
            )
          }}
        />
        <RuleEditor label={`New rule for ${toneSet.name}`} text={newRule} applyLabel="Add rule" onText={setNewRule} onApply={addRule} />
      </Collapsible>
      {others.length > 0 && <ApplyChoice uses={others} others={Boolean(here)} applyTo={applyTo} onChange={setApplyTo} />}
      {splits && (
        <>
          <label>
            Name for the earlier version
            <input
              value={earlierName}
              aria-required="true"
              aria-invalid={error?.field === 'earlier_name'}
              aria-describedby={[earlierNoteId, fieldError('earlier_name')].filter(Boolean).join(' ')}
              onChange={(event) => setEarlierName(event.target.value)}
            />
          </label>
          <p className="muted" id={earlierNoteId}>
            Saving adds a new tone named &ldquo;{name.trim() || toneSet.name}&rdquo;. The ones that keep this tone use it under this name.
          </p>
        </>
      )}
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

// A new rule's text, inside the tone's form, so it has no form of its own: its button puts the text
// in the list. An empty rule says so instead.
function RuleEditor({
  label,
  text,
  applyLabel,
  onText,
  onApply,
}: {
  label: string
  text: string
  applyLabel: string
  onText: (text: string) => void
  onApply: () => void
}) {
  const [empty, setEmpty] = useState(false)
  const errorId = useId()

  return (
    <div className="stacked-form">
      <label>
        {label}
        <textarea
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
          onClick={() => {
            if (!text.trim()) setEmpty(true)
            else onApply()
          }}
        >
          {applyLabel}
        </button>
      </div>
    </div>
  )
}
