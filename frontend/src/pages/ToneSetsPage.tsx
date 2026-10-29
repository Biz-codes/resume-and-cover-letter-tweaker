// Library page for tone sets: named groups of tone rules (docs/WRITING_RULES.md, "Tone rules").
// Add, rename, and delete sets, and add, edit, reorder, and delete each set's rules. A resume or
// cover letter can use one set. Tone rules only steer suggestions and are never printed, so
// edits are always made in place, even when a sent version uses the set.
import { useCallback, useEffect, useState } from 'react'
import { shortBullet } from '../api/bullets'
import { toApiError, type ApiError } from '../api/client'
import { toneSetsApi, type ToneSet } from '../api/toneSets'
import Collapsible from '../components/Collapsible'
import ConfirmDelete from '../components/ConfirmDelete'
import NameForm from '../components/NameForm'
import OrderedList from '../components/OrderedList'
import UsedBy from '../components/UsedBy'
import { PAGE_HEADING_ID, useFocusLater } from '../hooks/useFocusLater'
import { usePageTitle } from '../hooks/usePageTitle'

// What's open on a set's card: renaming or deleting the set, or editing or deleting one rule.
type Open =
  | { kind: 'rename' | 'delete'; setId: number }
  | { kind: 'edit-rule' | 'delete-rule'; setId: number; ruleId: number }

const setButtonId = (id: number, action: 'rename' | 'delete') => `tone-set-${id}-${action}`
const ruleButtonId = (id: number, action: 'edit' | 'delete') => `tone-rule-${id}-${action}`

const ruleLabel = (text: string) => `"${shortBullet(text)}"`

export default function ToneSetsPage() {
  const [sets, setSets] = useState<ToneSet[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()
  usePageTitle('Tone sets')

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

  function show(next: Open | null) {
    setOpen(next)
    setDeleteError(null)
    if (next) setNotice(null)
  }

  async function create(name: string) {
    await toneSetsApi.create(name)
    setNotice(`Added "${name.trim()}".`)
    await load()
  }

  async function rename(toneSet: ToneSet, name: string) {
    await toneSetsApi.rename(toneSet.tone_set_id, name)
    show(null)
    setNotice('Saved.')
    await load()
    focusLater(setButtonId(toneSet.tone_set_id, 'rename'))
  }

  async function saveRule(toneSet: ToneSet, ruleId: number, text: string) {
    await toneSetsApi.updateRule(toneSet.tone_set_id, ruleId, text)
    show(null)
    setNotice('Saved.')
    await load()
    focusLater(ruleButtonId(ruleId, 'edit'))
  }

  async function confirmDelete(action: () => Promise<unknown>, message: string) {
    setDeleteError(null)
    try {
      await action()
      show(null)
      focusLater(PAGE_HEADING_ID)
      setNotice(message)
      await load()
    } catch (error) {
      setDeleteError(toApiError(error))
    }
  }

  function card(toneSet: ToneSet) {
    const id = toneSet.tone_set_id
    const name = `"${toneSet.name}"`
    const here = open?.setId === id ? open : null
    const rule = here && 'ruleId' in here ? toneSet.rules.find((r) => r.tone_rule_id === here.ruleId) : undefined
    return (
      <article key={id} className="card">
        {here?.kind === 'rename' ? (
          <NameForm
            label="Tone set name"
            field="name"
            initial={toneSet.name}
            onSave={(text) => rename(toneSet, text)}
            onCancel={() => {
              show(null)
              focusLater(setButtonId(id, 'rename'))
            }}
          />
        ) : (
          <div className="card-header">
            <h3>{toneSet.name}</h3>
            {here?.kind !== 'delete' && (
              <div className="actions">
                <button
                  type="button"
                  id={setButtonId(id, 'rename')}
                  aria-label={`Rename ${name}`}
                  onClick={() => show({ kind: 'rename', setId: id })}
                >
                  Rename
                </button>
                <button
                  type="button"
                  id={setButtonId(id, 'delete')}
                  aria-label={`Delete ${name}`}
                  onClick={() => show({ kind: 'delete', setId: id })}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
        {here?.kind === 'delete' && (
          <ConfirmDelete
            what={name}
            uses={toneSet.used_by}
            effect="They keep going with no tone set."
            error={deleteError}
            onConfirm={() =>
              void confirmDelete(() => toneSetsApi.delete(id), `Deleted ${name} and its rules.`)
            }
            onCancel={() => {
              show(null)
              focusLater(setButtonId(id, 'delete'))
            }}
          />
        )}

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
                  onClick={() => show({ kind: 'edit-rule', setId: id, ruleId: item.id })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  id={ruleButtonId(item.id, 'delete')}
                  aria-label={`Delete ${item.label}`}
                  onClick={() => show({ kind: 'delete-rule', setId: id, ruleId: item.id })}
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
          {here?.kind === 'edit-rule' && rule && (
            <NameForm
              key={rule.tone_rule_id}
              label={`Edit rule ${ruleLabel(rule.rule_text)}`}
              field="rule_text"
              initial={rule.rule_text}
              multiline
              onSave={(text) => saveRule(toneSet, rule.tone_rule_id, text)}
              onCancel={() => {
                show(null)
                focusLater(ruleButtonId(rule.tone_rule_id, 'edit'))
              }}
            />
          )}
          {here?.kind === 'delete-rule' && rule && (
            <ConfirmDelete
              what={`the rule ${ruleLabel(rule.rule_text)}`}
              uses={[]}
              effect={null}
              error={deleteError}
              onConfirm={() =>
                void confirmDelete(
                  () => toneSetsApi.deleteRule(id, rule.tone_rule_id),
                  `Deleted the rule ${ruleLabel(rule.rule_text)}.`,
                )
              }
              onCancel={() => {
                show(null)
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
            }}
          />
        </Collapsible>

        <UsedBy uses={toneSet.used_by} />
      </article>
    )
  }

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Tone sets
      </h2>
      <p className="muted">
        Different kinds of jobs call for different word choice: a tech resume might lead with tools and metrics, a
        teaching one with students and outcomes. Each resume or cover letter can use one tone set, and its rules guide
        every suggestion for it.
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

      {sets && <NameForm label="New tone set name" field="name" submitLabel="Add tone set" onSave={create} />}
      {sets && sets.length === 0 && <p>No tone sets yet.</p>}
      {sets?.map(card)}
    </section>
  )
}
