// "Suggest a new tone" on a posting's Start form: Claude writes a tone for the resume or cover letter
// being started, from the posting and the user's earlier documents, and the user reviews it in the
// tone's usual form, filled in. Each rule is badged "Library" (a saved rule reused) or "Claude" (new
// wording), with Claude's reason under "Rationale"; the user renames the tone, edits a new rule's
// wording, removes rules, and adds saved ones (under "More options") or their own, then "Save tone".
// Nothing is saved until then, and new rules join the library only then. Text that matches a saved
// rule is that rule. See "Claude's suggested tone" in docs/FRONTEND_CHECKS.md.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toApiError, type ApiError } from '../shared/api/client'
import { KINDS, type DocKind } from '../shared/api/documents'
import { ruleLabel, toneRulesApi, type ToneRule } from '../shared/api/toneRules'
import { toneSetsApi, type ToneSet, type ToneSuggestion } from '../shared/api/toneSets'
import MoreOptions from '../shared/components/MoreOptions'
import { useFocusLater } from '../shared/hooks/useFocusLater'
import { offered } from '../shared/offered'
import { Rationale, Row } from '../documents/DraftTree/DraftTree'
import RuleEditor from '../library/items/RuleEditor'

// A rule in the form: a saved one by its id, or new text, with a negative id until it's saved.
// `claude` is Claude's reason, for the rules it suggested; `edited`, when the user changed
// Claude's new wording (so it's no longer badged as Claude's).
interface Rule {
  id: number
  text: string
  reason?: string
  claude: boolean
  edited?: boolean
}

const sameText = (a: string, b: string) => a.split(/\s+/).join(' ').toLowerCase() === b.split(/\s+/).join(' ').toLowerCase()

export default function SuggestTone({
  kind,
  postingId,
  onSaved,
  onCancel,
}: {
  kind: DocKind
  postingId: number
  onSaved: (toneSet: ToneSet) => Promise<void>
  onCancel: () => void
}) {
  const { singular } = KINDS[kind]
  const [suggestion, setSuggestion] = useState<ToneSuggestion | null>(null)
  const [saved, setSaved] = useState<ToneRule[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingId = useId()

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    let current = true
    Promise.all([toneSetsApi.suggest(postingId, kind), toneRulesApi.list()])
      .then(([found, rules]) => {
        if (!current) return
        setSuggestion(found)
        setSaved(rules)
      })
      .catch((error: unknown) => current && setLoadError(toApiError(error)))
    return () => {
      current = false
    }
  }, [postingId, kind, attempt])

  return (
    <section className="card stacked-form" aria-labelledby={headingId}>
      <h4 id={headingId} ref={headingRef} tabIndex={-1}>
        Claude&apos;s suggested tone
      </h4>
      {/* Always rendered, so screen readers hear it while Claude writes. */}
      <p aria-live="polite">{!suggestion && !loadError ? `Claude is writing a tone for this ${singular}. This can take a minute.` : ''}</p>
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          <button
            type="button"
            onClick={() => {
              setLoadError(null)
              setAttempt(attempt + 1)
              // Retry goes away while Claude writes, so focus goes back to the heading.
              headingRef.current?.focus()
            }}
          >
            Retry
          </button>
        </div>
      )}
      {suggestion ? (
        <ToneReview suggestion={suggestion} saved={saved} onSaved={onSaved} onCancel={onCancel} />
      ) : (
        <div className="actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </section>
  )
}

function ToneReview({
  suggestion,
  saved,
  onSaved,
  onCancel,
}: {
  suggestion: ToneSuggestion
  saved: ToneRule[]
  onSaved: (toneSet: ToneSet) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(suggestion.name)
  const [rules, setRules] = useState<Rule[]>(() =>
    suggestion.rules.map((rule, index) => ({
      id: rule.tone_rule_id ?? -(index + 1),
      text: rule.rule_text,
      reason: rule.reason,
      claude: true,
    })),
  )
  const [nextId, setNextId] = useState(-(suggestion.rules.length + 1))
  const [newRule, setNewRule] = useState('')
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  // Where focus goes once a row is gone: the Rules heading, which stays when the last one is.
  const rulesRef = useRef<HTMLHeadingElement>(null)
  const focusLater = useFocusLater()
  const id = useId()
  const errorId = `${id}-error`
  const editId = (ruleId: number) => `${id}-edit-${ruleId}`
  const fieldId = (ruleId: number) => `${id}-field-${ruleId}`

  // The form opens in place of the waiting message, so focus moves to its first field.
  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  // The saved rule with this text, or new text, unless the tone already has it (`except`, the rule
  // being edited).
  function resolve(text: string, except?: number): Rule | string {
    const clean = text.split(/\s+/).join(' ').trim()
    if (rules.some((rule) => rule.id !== except && sameText(rule.text, clean))) return `This tone already has the rule ${ruleLabel(clean)}.`
    const match = saved.find((rule) => sameText(rule.rule_text, clean))
    return match ? { id: match.tone_rule_id, text: match.rule_text, claude: false } : { id: nextId, text: clean, claude: false }
  }

  function addRule() {
    const found = resolve(newRule)
    if (typeof found === 'string') {
      setAnnouncement(found)
      return
    }
    setRules([...rules, found])
    if (found.id === nextId) setNextId(nextId - 1)
    setNewRule('')
    setAnnouncement(found.id > 0 ? `Added your saved rule ${ruleLabel(found.text)}.` : `Added the rule ${ruleLabel(found.text)}.`)
  }

  function finishEdit(rule: Rule) {
    if (!editing) return
    if (!editing.text.trim()) {
      setEditError('Type the rule, or remove it instead.')
      return
    }
    if (sameText(editing.text, rule.text)) {
      setEditing(null)
      focusLater(editId(rule.id))
      return
    }
    const found = resolve(editing.text, rule.id)
    if (typeof found === 'string') {
      setEditError(found)
      return
    }
    // A new id when it became a saved rule, so focus goes to that row's button.
    const next: Rule = found.id > 0 ? found : { ...rule, text: found.text, edited: true }
    setRules(rules.map((other) => (other.id === rule.id ? next : other)))
    setEditing(null)
    setEditError(null)
    setAnnouncement(next.id > 0 ? `Changed it to your saved rule ${ruleLabel(next.text)}.` : `Changed the rule to ${ruleLabel(next.text)}.`)
    // A saved rule has no wording to edit here, so focus goes to the list.
    if (next.id > 0) rulesRef.current?.focus()
    else focusLater(editId(next.id))
  }

  function remove(rule: Rule) {
    setRules(rules.filter((other) => other.id !== rule.id))
    setAnnouncement(`Removed ${ruleLabel(rule.text)}.`)
    rulesRef.current?.focus()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const toneSet = await toneSetsApi.create(
        name,
        rules.map((rule) => (rule.id > 0 ? { tone_rule_id: rule.id } : { rule_text: rule.text })),
      )
      await onSaved(toneSet)
    } catch (caught) {
      setError(toApiError(caught))
      setSaving(false)
    }
  }

  const listed = new Set(rules.map((rule) => rule.id))
  const choices = offered(saved)
    .filter((rule) => !listed.has(rule.tone_rule_id))
    .map((rule) => ({
      id: rule.tone_rule_id,
      name: rule.rule_text,
      label: ruleLabel(rule.rule_text),
      group: rule.built_in ? 'Built-in rules' : 'Your rules',
    }))
  const label = `${name.trim() || suggestion.name} rules`

  return (
    <form className="stacked-form" onSubmit={submit} aria-label={`Review "${suggestion.name}"`}>
      <Rationale name={`"${suggestion.name}"`} reason={suggestion.reason} />
      <label>
        Tone name
        <input
          ref={nameRef}
          value={name}
          aria-required="true"
          aria-invalid={error?.field === 'name'}
          aria-describedby={error?.field === 'name' ? errorId : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <h5 ref={rulesRef} tabIndex={-1}>
        Rules
      </h5>
      {rules.length === 0 ? (
        <p>No rules yet.</p>
      ) : (
        <ul aria-label={label}>
          {rules.map((rule) => {
            const short = ruleLabel(rule.text)
            const source = rule.id > 0 ? 'library' : rule.claude && !rule.edited ? 'claude' : undefined
            const open = editing?.id === rule.id
            return (
              <Row key={rule.id} name={rule.text} label={short} source={source} onReject={() => remove(rule)} rejectText="Remove">
                {rule.claude && rule.reason && <Rationale name={short} reason={rule.reason} />}
                {rule.id < 0 && !open && (
                  <div className="actions">
                    <button
                      type="button"
                      id={editId(rule.id)}
                      aria-label={`Edit wording of ${short}`}
                      onClick={() => {
                        setEditing({ id: rule.id, text: rule.text })
                        focusLater(fieldId(rule.id))
                      }}
                    >
                      Edit wording
                    </button>
                  </div>
                )}
                {open && (
                  <div className="stacked-form" role="group" aria-label={`Edit wording of ${short}`}>
                    <label>
                      Wording
                      <textarea
                        id={fieldId(rule.id)}
                        rows={2}
                        value={editing.text}
                        aria-invalid={Boolean(editError)}
                        aria-describedby={editError ? `${fieldId(rule.id)}-error` : undefined}
                        onChange={(event) => {
                          setEditError(null)
                          setEditing({ id: rule.id, text: event.target.value })
                        }}
                      />
                    </label>
                    {editError && (
                      <p role="alert" id={`${fieldId(rule.id)}-error`}>
                        {editError}
                      </p>
                    )}
                    <div className="actions">
                      <button type="button" onClick={() => finishEdit(rule)}>
                        Done
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(null)
                          setEditError(null)
                          focusLater(editId(rule.id))
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </Row>
            )
          })}
        </ul>
      )}
      <MoreOptions
        label={label}
        choices={choices}
        onAdd={async (ids) => {
          const added = ids
            .map((ruleId) => saved.find((rule) => rule.tone_rule_id === ruleId))
            .filter((rule): rule is ToneRule => Boolean(rule))
            .map((rule) => ({ id: rule.tone_rule_id, text: rule.rule_text, claude: false }))
          setRules([...rules, ...added])
          setAnnouncement(`Added ${added.length} to ${label}.`)
          return true
        }}
      >
        <RuleEditor label={`New rule for ${name.trim() || suggestion.name}`} text={newRule} applyLabel="Add rule" onText={setNewRule} onApply={addRule} />
      </MoreOptions>
      {/* A plain live region rather than role="status", so the page's notices stay in AlertDialog. */}
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
      {error && (
        <p role="alert" id={errorId}>
          {error.message}
        </p>
      )}
      <div className="actions">
        {/* aria-disabled, not disabled, so a focused button keeps focus while saving. */}
        <button type="submit" aria-disabled={saving}>
          {saving ? 'Saving…' : 'Save tone'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
