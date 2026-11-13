// A tone rule's dialog: edit its text, or delete it. A rule is a library item any tone can list, so
// editing it follows "Changing an item" in docs/FRONTEND_CHECKS.md across every tone that lists it:
// resumes and cover letters in progress whose tone lists it change only if the user picks them, and
// sent ones never do. When the edit saves a tone used by both picked ones and others as a new tone,
// the form asks what to call that tone's earlier version, starting from "[name] (earlier)". The
// tones that list it open in the same dialog.
import { useEffect, useId, useRef, useState } from 'react'
import { shortBullet } from '../../shared/api/bullets'
import { toApiError, type ApiError } from '../../shared/api/client'
import { splitTones, toneRulesApi, type ToneListing, type ToneRule } from '../../shared/api/toneRules'
import { anyLocked, type Use } from '../../shared/api/usage'
import ConfirmDelete from '../../shared/components/ConfirmDelete'
import NameForm from '../../shared/components/NameForm/NameForm'
import ApplyChoice from '../ApplyChoice'
import { changeNote, inProgressUses, pickedFor, savedMessage } from '../applyChange'
import NameList from '../NameList'
import UsedBy from '../UsedBy'
import { useItemHost } from './itemHost'
import ItemLoading from './ItemLoading'
import ItemParts from './ItemParts'
import { useItemData } from './useItemData'

const SENT_NOTE = "A sent version's tone lists this rule, so saving adds a new rule. The sent version keeps this one."

export default function ToneRuleItem({ id }: { id: number }) {
  const host = useItemHost()
  const { data, error, load } = useItemData(() => toneRulesApi.list())
  const [applyTo, setApplyTo] = useState<Use[]>([])
  const [earlierNames, setEarlierNames] = useState<Record<number, string>>({})
  const [deleteError, setDeleteError] = useState<ApiError | null>(null)

  const rule = data?.find((item) => item.tone_rule_id === id)
  if (!data || !rule) return <ItemLoading error={error} missing={Boolean(data)} onRetry={() => void load()} />
  const label = `"${shortBullet(rule.rule_text)}"`
  const { here, others, elsewhere } = inProgressUses(rule.used_by, host.placed?.where)
  const picked = pickedFor(here, applyTo)
  const splits = splitTones(rule, picked)
  const earlierName = (toneId: number, name: string) => earlierNames[toneId] ?? `${name} (earlier)`

  async function save(original: ToneRule, text: string) {
    const saved = await toneRulesApi.update(
      original.tone_rule_id,
      text,
      picked,
      Object.fromEntries(splits.map((tone) => [tone.tone_set_id, earlierName(tone.tone_set_id, tone.name)])),
    )
    const message = savedMessage({
      newVersion: saved.tone_rule_id !== original.tone_rule_id,
      before: shortBullet(original.rule_text),
      after: shortBullet(saved.rule_text),
      here,
      doc: host.placed?.doc,
      checked: applyTo,
    })
    const renamed = splits.map((tone) => `"${earlierName(tone.tone_set_id, tone.name).trim()}"`)
    await host.saved(
      renamed.length ? `${message} Earlier versions kept as ${renamed.join(', ')}.` : message,
      { kind: 'toneRule', id: saved.tone_rule_id },
    )
  }

  async function confirmDelete(original: ToneRule) {
    setDeleteError(null)
    try {
      await toneRulesApi.delete(original.tone_rule_id)
      await host.deleted(`Deleted ${label}.`)
    } catch (caught) {
      setDeleteError(toApiError(caught))
    }
  }

  return (
    <ItemParts
      name={label}
      hidden={rule.hidden}
      usedBySent={anyLocked(rule.used_by)}
      onSetHidden={async (next) => {
        await toneRulesApi.setHidden(rule.tone_rule_id, next)
        await Promise.all([load(), host.refresh()])
      }}
      form={
        <NameForm
          label="Rule"
          field="rule_text"
          multiline
          initial={rule.rule_text}
          lockedNote={changeNote(here, others, host.placed?.doc, anyLocked(rule.used_by) ? SENT_NOTE : undefined, elsewhere)}
          onSave={(text) => save(rule, text)}
          focusOnOpen={false}
          onCancel={host.close}
        >
          {others.length > 0 && <ApplyChoice uses={others} others={Boolean(here)} applyTo={applyTo} onChange={setApplyTo} />}
          <EarlierNames
            splits={splits}
            nameOf={earlierName}
            onName={(toneId, name) => setEarlierNames({ ...earlierNames, [toneId]: name })}
          />
        </NameForm>
      }
      confirmDelete={(back) => (
        <ConfirmDelete
          what={label}
          uses={rule.used_by}
          effect="It's taken out of their tones, and out of every other tone that lists it."
          error={deleteError}
          onConfirm={() => void confirmDelete(rule)}
          onCancel={back}
        />
      )}
    >
      <NameList title="Tones" refs={rule.tones.map((tone) => ({ kind: 'tone', id: tone.tone_set_id, title: tone.name }))} />
      <UsedBy uses={rule.used_by} />
    </ItemParts>
  )
}

// A name for the earlier version of each tone the edit saves as a new one (used by picked ones and
// others), which the rest keep using. Which tones those are changes as ones in progress are checked,
// so each change is said in the dialog's notice.
function EarlierNames({
  splits,
  nameOf,
  onName,
}: {
  splits: ToneListing[]
  nameOf: (toneId: number, name: string) => string
  onName: (toneId: number, name: string) => void
}) {
  const host = useItemHost()
  const namesId = useId()
  const names = splits.map((tone) => tone.name).join(', ')
  const said = useRef(names)
  useEffect(() => {
    if (said.current === names) return
    said.current = names
    host.say(names ? `Saving also adds new versions of ${names}. Name the earlier versions below.` : 'No tone needs a name for an earlier version now.')
  })
  if (splits.length === 0) return null
  return (
    <fieldset aria-describedby={namesId}>
      <legend>Names for the earlier versions</legend>
      <p className="muted" id={namesId}>
        These tones are saved as new ones with the new rule. The ones that keep them use the earlier versions under these names.
      </p>
      {splits.map((tone) => (
        <label key={tone.tone_set_id}>
          Earlier version of {tone.name}
          <input value={nameOf(tone.tone_set_id, tone.name)} aria-required="true" onChange={(event) => onName(tone.tone_set_id, event.target.value)} />
        </label>
      ))}
    </fieldset>
  )
}
