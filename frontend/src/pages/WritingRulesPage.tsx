// Library page for writing rules (docs/WRITING_RULES.md): banned words and phrases (terms),
// and patterns described in words. Add, edit, switch off or on, and delete them. Rules only
// steer suggestions and are never printed, so edits are always made in place.
import { useCallback, useEffect, useState } from 'react'
import { toApiError, type ApiError } from '../api/client'
import { writingRulesApi, type RuleKind, type WritingRule } from '../api/writingRules'
import ConfirmDelete from '../components/ConfirmDelete'
import NameForm from '../components/NameForm'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

const GROUPS: { kind: RuleKind; heading: string; note: string; newLabel: string; submitLabel: string }[] = [
  {
    kind: 'term',
    heading: 'Words and phrases',
    note: 'Found by exact match. A technical term, a proper noun, or the plain literal meaning is still allowed.',
    newLabel: 'New word or phrase',
    submitLabel: 'Add word or phrase',
  },
  {
    kind: 'pattern',
    heading: 'Patterns',
    note: 'Described in words, so the AI can spot them (e.g. "lists of three used for rhythm").',
    newLabel: 'New pattern',
    submitLabel: 'Add pattern',
  },
]

const buttonId = (id: number, action: 'edit' | 'toggle' | 'delete') => `rule-${id}-${action}`

export default function WritingRulesPage() {
  const [rules, setRules] = useState<WritingRule[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  // A failed Turn off / Turn on, shown in that rule's row.
  const [toggleError, setToggleError] = useState<{ id: number; error: ApiError } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Writing rules')

  const load = useCallback(
    () =>
      writingRulesApi
        .list()
        .then((list) => {
          setRules(list)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function create(kind: RuleKind, text: string) {
    await writingRulesApi.create({ kind, rule_text: text, active: true })
    setNotice(`Added "${text.trim()}".`)
    await load()
  }

  async function save(rule: WritingRule, text: string) {
    await writingRulesApi.update(rule.writing_rule_id, { ...rule, rule_text: text })
    setEditing(null)
    setNotice('Saved.')
    await load()
    focusLater(buttonId(rule.writing_rule_id, 'edit'))
  }

  // The button stays in place with its new name, so focus stays on it.
  async function toggle(rule: WritingRule) {
    setToggleError(null)
    try {
      await writingRulesApi.update(rule.writing_rule_id, { ...rule, active: !rule.active })
      setNotice(rule.active ? `Turned off "${rule.rule_text}".` : `Turned on "${rule.rule_text}".`)
      await load()
    } catch (error) {
      setToggleError({ id: rule.writing_rule_id, error: toApiError(error) })
    }
  }

  async function confirmDelete(rule: WritingRule) {
    setDeleteError(null)
    try {
      await writingRulesApi.delete(rule.writing_rule_id)
      setDeleting(null)
      focusLater(PAGE_HEADING_ID)
      setNotice(`Deleted "${rule.rule_text}".`)
      await load()
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  function row(rule: WritingRule) {
    const label = `"${rule.rule_text}"`
    const id = rule.writing_rule_id
    return (
      <li key={id} className="rule">
        {editing === id ? (
          <NameForm
            label={rule.kind === 'term' ? 'Word or phrase' : 'Pattern'}
            field="rule_text"
            initial={rule.rule_text}
            multiline={rule.kind === 'pattern'}
            onSave={(text) => save(rule, text)}
            onCancel={() => {
              setEditing(null)
              focusLater(buttonId(id, 'edit'))
            }}
          />
        ) : (
          <div className="card-header">
            <span>
              {rule.rule_text}
              {!rule.active && <span className="tag">off</span>}
            </span>
            {deleting !== id && (
              <div className="actions">
                <button
                  type="button"
                  id={buttonId(id, 'edit')}
                  aria-label={`Edit ${label}`}
                  onClick={() => {
                    setEditing(id)
                    setDeleting(null)
                    setNotice(null)
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  id={buttonId(id, 'toggle')}
                  aria-label={`${rule.active ? 'Turn off' : 'Turn on'} ${label}`}
                  onClick={() => void toggle(rule)}
                >
                  {rule.active ? 'Turn off' : 'Turn on'}
                </button>
                <button
                  type="button"
                  id={buttonId(id, 'delete')}
                  aria-label={`Delete ${label}`}
                  onClick={() => {
                    setDeleting(id)
                    setDeleteError(null)
                    setEditing(null)
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
        {toggleError?.id === id && <p role="alert">{toggleError.error.message}</p>}
        {deleting === id && (
          <ConfirmDelete
            what={label}
            uses={[]}
            effect={null}
            error={deleteError}
            onConfirm={() => void confirmDelete(rule)}
            onCancel={() => {
              setDeleting(null)
              focusLater(buttonId(id, 'delete'))
            }}
          />
        )}
      </li>
    )
  }

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Writing rules
      </h2>
      <p className="muted">
        Filler and AI-sounding phrasing the app keeps out of every suggestion. Turn a rule off to keep it without applying
        it.
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
      {!rules && !loadError && <p>Loading…</p>}

      {rules &&
        GROUPS.map(({ kind, heading, note, newLabel, submitLabel }) => {
          const members = rules.filter((rule) => rule.kind === kind)
          return (
            <div key={kind} className="section-group">
              <h3>{heading}</h3>
              <p className="muted">{note}</p>
              {members.length === 0 ? <p>None yet.</p> : <ul className="rules">{members.map(row)}</ul>}
              <NameForm
                label={newLabel}
                field="rule_text"
                submitLabel={submitLabel}
                multiline={kind === 'pattern'}
                onSave={(text) => create(kind, text)}
              />
            </div>
          )
        })}
    </section>
  )
}
