// "Claude's first draft": Claude's draft of a posting's resume or cover letter as the user approved
// it, kept to look back on (backend/app/drafts.py, snapshot), opened read-only in a dialog from the
// document's page. Only what the user kept is in it, each row with its name or text as it was then,
// the badge it had in the review ("Original", "Library", or "Claude"), the writing rules it broke,
// and Claude's rationale, with both wordings of a rewording. Nothing here changes anything, so it
// has no Reject and no switching wordings.
import { useState } from 'react'
import { Link } from 'react-router'
import { shortBullet } from '../../shared/api/bullets'
import { KINDS, type DocKind, type FirstDraft as Kept, type FirstDraftRow } from '../../shared/api/documents'
import Dialog from '../../shared/components/Dialog/Dialog'
import { Rationale, Row } from '../DraftTree/DraftTree'
import styles from '../DraftTree/DraftTree.module.css'
import { KIND_NAMES } from '../treeItems'

const isText = (kind: string) => kind === 'narrative' || kind === 'bullet'

function RowRationale({ row, name }: { row: FirstDraftRow; name: string }) {
  return (
    <Rationale
      name={name}
      reason={row.reason}
      claude={row.rewording ? { text: row.rewording.claude } : undefined}
      original={row.rewording?.original}
      useOriginal={row.rewording?.use_original}
    />
  )
}

function KeptRows({ kept }: { kept: Kept }) {
  if (kept.sections.length === 0) return <p className="muted">No sections in the draft.</p>
  return (
    <ul aria-label="Sections" className={styles.sections}>
      {kept.sections.map((section, sectionIndex) => {
        const where = `in ${section.name}`
        return (
          <Row key={sectionIndex} name={<strong>{section.name}</strong>} label={`section "${section.name}"`} source={section.source}>
            <RowRationale row={section} name={`section "${section.name}"`} />
            {section.entries.length === 0 ? (
              <p className="muted">Nothing here.</p>
            ) : (
              <ul aria-label={`Items in ${section.name}`} className={styles.entries}>
                {section.entries.map((entry, entryIndex) => {
                  const short = isText(entry.kind) ? `"${shortBullet(entry.name)}"` : entry.name
                  const label = `${KIND_NAMES[entry.kind].one}: ${short} ${where}`
                  return (
                    <Row
                      key={entryIndex}
                      name={
                        <>
                          <span className="muted">{KIND_NAMES[entry.kind].one}:</span> {entry.name}
                        </>
                      }
                      label={label}
                      source={entry.source}
                      flags={entry.flags}
                    >
                      <RowRationale row={entry} name={label} />
                      {entry.skills.length > 0 && (
                        <ul aria-label={`Skills under ${short} ${where}`} className={styles.children}>
                          {entry.skills.map((skill, index) => (
                            <Row key={index} name={skill.name} label={`${skill.name} under ${short} ${where}`} source={skill.source} />
                          ))}
                        </ul>
                      )}
                      {entry.bullets.length > 0 && (
                        <ul aria-label={`Bullets under ${short} ${where}`} className={styles.children}>
                          {entry.bullets.map((bullet, index) => {
                            const bulletLabel = `"${shortBullet(bullet.name)}" under ${short} ${where}`
                            return (
                              <Row key={index} name={bullet.name} label={bulletLabel} source={bullet.source} flags={bullet.flags}>
                                <RowRationale row={bullet} name={bulletLabel} />
                              </Row>
                            )
                          })}
                        </ul>
                      )}
                    </Row>
                  )
                })}
              </ul>
            )}
          </Row>
        )
      })}
    </ul>
  )
}

export default function FirstDraft({ kind, firstDraft }: { kind: DocKind; firstDraft: Kept }) {
  const [open, setOpen] = useState(false)
  const { path, singular } = KINDS[kind]
  const greeting = firstDraft.greeting
  const said = (addressee: string | null) => (addressee ? `Dear ${addressee},` : 'No greeting.')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Claude&apos;s first draft
      </button>
      {open && (
        <Dialog title="Claude's first draft" onClose={() => setOpen(false)}>
          <p className="muted">As you approved it, before any later changes.</p>
          <p>
            {firstDraft.starting_document ? (
              <>
                Claude started from <Link to={`${path}/${firstDraft.starting_document.id}`}>{firstDraft.starting_document.name}</Link>.{' '}
              </>
            ) : firstDraft.started_from === 'own' ? (
              `Claude started from your ${singular}. `
            ) : (
              'Claude started from your library. '
            )}
            {firstDraft.starting_reason}
          </p>
          {firstDraft.tone && (
            <p>
              {firstDraft.tone.reason
                ? `Claude picked the "${firstDraft.tone.name}" tone. ${firstDraft.tone.reason}`
                : `Uses the "${firstDraft.tone.name}" tone, the usual one, since Claude's pick couldn't be used.`}
            </p>
          )}
          {!firstDraft.checked && (
            <p>Claude couldn&apos;t check this draft against your writing rules, so nothing in it is flagged.</p>
          )}
          {greeting && (
            <>
              <h3>Greeting</h3>
              <ul aria-label="Greeting" className={styles.sections}>
                <Row
                  name={said(greeting.use_default ? greeting.usual : greeting.claude)}
                  label="greeting"
                  source={greeting.use_default ? undefined : 'claude'}
                >
                  <Rationale
                    name="greeting"
                    reason={greeting.reason}
                    claude={{ text: said(greeting.claude) }}
                    original={said(greeting.usual)}
                    useOriginal={greeting.use_default}
                    words={{ original: 'Usual greeting', useOriginal: 'Use the usual greeting', useClaude: "Use Claude's greeting" }}
                  />
                </Row>
              </ul>
            </>
          )}
          <h3>Sections</h3>
          <KeptRows kept={firstDraft} />
        </Dialog>
      )}
    </>
  )
}
