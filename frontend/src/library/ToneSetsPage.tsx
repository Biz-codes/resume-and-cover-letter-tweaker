// Library page for tones and tone rules (docs/WRITING_RULES.md, "Tone rules"), in two groups, as
// the Skills page shows categories and skills. The database and API call a tone a tone set
// (tone_set); the app says "tone". A tone lists rules in order, and one rule can be in many tones.
// Add tones and rules, and open each one's dialog (ToneItem, ToneRuleItem) to change or delete it.
// A resume or cover letter can use one tone.
import { useCallback, useEffect, useState } from 'react'
import { shortBullet } from '../shared/api/bullets'
import { toApiError, type ApiError } from '../shared/api/client'
import { toneRulesApi, type ToneRule } from '../shared/api/toneRules'
import { toneSetsApi, type ToneSet } from '../shared/api/toneSets'
import NameForm from '../shared/components/NameForm/NameForm'
import { PAGE_HEADING_ID } from '../shared/hooks/useFocusLater'
import { usePageTitle } from '../shared/hooks/usePageTitle'
import { useItemDialogs } from './items/ItemDialogs'
import { editId } from './items/itemHost'
import HiddenItems, { UnhideButton } from './HiddenItems'
import LibraryCard from './LibraryCard'
import { SORT_NOTE, sortByName } from '../shared/sortByName'
import { useUnhide } from './useUnhide'
import AlertDialog from '../shared/components/Dialog/AlertDialog'

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

export default function ToneSetsPage() {
  const [sets, setSets] = useState<ToneSet[] | null>(null)
  const [rules, setRules] = useState<ToneRule[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  usePageTitle('Tones')

  const load = useCallback(
    () =>
      Promise.all([toneSetsApi.list(), toneRulesApi.list()])
        .then(([setList, ruleList]) => {
          setSets(setList)
          setRules(ruleList)
          setLoadError(null)
        })
        .catch((error: unknown) => setLoadError(toApiError(error))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const dialogs = useItemDialogs({ reload: load, notify: setNotice })
  const unhide = useUnhide(load, setNotice)

  function toneCard(toneSet: ToneSet, hidden = false) {
    const title = toneSet.name
    return (
      <LibraryCard
        key={toneSet.tone_set_id}
        title={title}
        editId={editId('tone', toneSet.tone_set_id)}
        editLabel={`View and Edit "${title}"`}
        onEdit={() => dialogs.open({ kind: 'tone', id: toneSet.tone_set_id, title })}
        actions={
          hidden && (
            <UnhideButton
              name={title}
              onUnhide={() => unhide('tone', toneSet.tone_set_id, title, () => toneSetsApi.setHidden(toneSet.tone_set_id, false))}
            />
          )
        }
      >
        <p className="muted">{count(toneSet.rules.length, 'rule', 'rules')}</p>
      </LibraryCard>
    )
  }

  function ruleCard(rule: ToneRule, hidden = false) {
    const title = shortBullet(rule.rule_text)
    return (
      <LibraryCard
        key={rule.tone_rule_id}
        title={rule.rule_text}
        titleClassName="bullet-text"
        editId={editId('toneRule', rule.tone_rule_id)}
        editLabel={`View and Edit "${title}"`}
        onEdit={() => dialogs.open({ kind: 'toneRule', id: rule.tone_rule_id, title })}
        actions={
          hidden && (
            <UnhideButton
              name={title}
              onUnhide={() => unhide('toneRule', rule.tone_rule_id, title, () => toneRulesApi.setHidden(rule.tone_rule_id, false))}
            />
          )
        }
      >
        <p className="muted">
          {rule.tones.length ? `In ${rule.tones.map((tone) => tone.name).join(', ')}` : 'In no tone yet.'}
        </p>
      </LibraryCard>
    )
  }

  const allSets = sortByName(sets ?? [], (toneSet) => toneSet.name)
  const allRules = sortByName(rules, (rule) => rule.rule_text)

  return (
    <section>
      <h2 id={PAGE_HEADING_ID} tabIndex={-1}>
        Tones
      </h2>
      <p className="muted">
        Different kinds of jobs call for different word choice: a tech resume might lead with tools and metrics, a
        teaching one with students and outcomes. Each resume or cover letter can use one tone, and its rules guide every
        suggestion for it. A rule can be in more than one tone.
      </p>
      <p className="muted">{SORT_NOTE}</p>
      <AlertDialog message={notice} onClose={() => setNotice(null)} />
      {loadError && (
        <div role="alert">
          <p>{loadError.message}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!sets && !loadError && <p>Loading…</p>}

      {sets && (
        <>
          <NameForm label="New tone name" field="name" submitLabel="Add tone" onSave={async (name) => {
            await toneSetsApi.create(name)
            await load()
            setNotice(`Added "${name.trim()}".`)
          }} />
          <h3>All tones</h3>
          {sets.length === 0 && <p>No tones yet.</p>}
          {allSets.filter((toneSet) => !toneSet.hidden).map((toneSet) => toneCard(toneSet))}

          <h3>All tone rules</h3>
          <NameForm
            label="New tone rule"
            field="rule_text"
            multiline
            submitLabel="Add rule"
            onSave={async (text) => {
              const added = await toneRulesApi.create(text)
              await load()
              const shown = `"${shortBullet(added.rule_text)}"`
              // A rule with the same text is the saved one (docs/FRONTEND_CHECKS.md).
              setNotice(rules.some((rule) => rule.tone_rule_id === added.tone_rule_id) ? `You already have the rule ${shown}.` : `Added ${shown}.`)
            }}
          />
          {rules.length === 0 && <p>No tone rules yet.</p>}
          {allRules.filter((rule) => !rule.hidden).map((rule) => ruleCard(rule))}
        </>
      )}
      <HiddenItems count={allSets.filter((toneSet) => toneSet.hidden).length + allRules.filter((rule) => rule.hidden).length}>
        {allSets.filter((toneSet) => toneSet.hidden).map((toneSet) => toneCard(toneSet, true))}
        {allRules.filter((rule) => rule.hidden).map((rule) => ruleCard(rule, true))}
      </HiddenItems>
      {dialogs.dialog}
    </section>
  )
}
