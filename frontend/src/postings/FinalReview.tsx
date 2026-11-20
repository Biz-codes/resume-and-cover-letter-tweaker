// "Review together" on a posting's page (docs/APP_FLOW.md, step 7, "Review the whole thing"):
// Claude reviews the posting's resume and cover letter together (backend/app/final_review.py),
// and the latest review is kept with the posting. It shows the posting's keywords with which
// document covers each, then the findings grouped by kind, each naming its document with a link
// to it. Once either document changes, it says the review is out of date, with "Review again".
// A posting applied to can be reviewed too, to see what to do better next time, but its fixes are
// only shown, since its resume and cover letter can't change.
//
// The button stays while Claude reviews (its text changes, so it keeps focus), and the panel's
// own live region says it's reviewing; the page's notice says what it found.
//
// Each finding's fixes are proposal cards like the chat's (ProposalCard), named for where the
// change is in its document (both documents' sections are read for that), with their writing
// flags and whether each waiting one would take its document past its pages. Apply makes the
// change to its document, Undo puts it back while the document is still as the fix left it,
// and Dismiss and Restore change only the card; each is said in the live region, and focus
// stays on the card. The review's own fixes don't make it out of date.
import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { toApiError, type ApiError } from '../shared/api/client'
import { capitalize, docsApi, KINDS, type TreeSection } from '../shared/api/documents'
import Disclosure from '../shared/components/Disclosure/Disclosure'
import { useFocusLater } from '../shared/hooks/useFocusLater'
import type { ListState } from '../documents/DocumentsPage'
import { ProposalCard } from '../documents/ProposalCards/ProposalCards'
import { describe } from '../documents/ProposalCards/describe'
import cardStyles from '../documents/ProposalCards/ProposalCards.module.css'
import { postingsApi, type Coverage, type Fix, type FindingKind, type PostingDetail, type ReviewedDoc } from './postings'

const GROUPS: { kind: FindingKind; title: string }[] = [
  { kind: 'keyword', title: 'Keywords they miss' },
  { kind: 'repeated', title: 'Repeated wording' },
  { kind: 'inconsistent', title: 'Inconsistencies' },
  { kind: 'writing', title: 'Writing rules' },
]

const COVERED: Record<Coverage['covered_by'], string> = {
  resume: 'the resume',
  cover_letter: 'the cover letter',
  both: 'both',
  neither: 'not covered',
}

const docName = (kind: ReviewedDoc) => capitalize(KINDS[kind].singular)

const fixId = (fix: Fix) => `review-fix-${fix.proposal.id}`

const staleNote = (stale: number) =>
  stale === 0 ? '' : ` ${stale === 1 ? '1 other fix for the same content is' : `${stale} other fixes for the same content are`} now stale.`

// "2026-11-18T12:00:00Z" → "November 18, 2026".
const showDay = (value: string) => new Date(value).toLocaleDateString('en-US', { dateStyle: 'long' })

// What the page's notice says once it's done: what it reviewed and how many findings.
export function reviewedNotice(posting: PostingDetail) {
  const kinds = (['resume', 'cover_letter'] as const).filter((kind) => posting.versions.some((use) => use.kind === kind))
  const what = kinds.length === 2 ? 'the resume and cover letter together' : `the ${KINDS[kinds[0] ?? 'resume'].singular}`
  const count = posting.final_review?.findings.length ?? 0
  const found = count === 0 ? 'Nothing to fix.' : count === 1 ? '1 finding below.' : `${count} findings below.`
  return `Reviewed ${what}. ${found}`
}

export default function FinalReview({
  posting,
  onReviewed,
  onChanged,
}: {
  posting: PostingDetail
  // The posting with its new review.
  onReviewed: (updated: PostingDetail) => void
  // The posting after a fix was applied, undone, dismissed, or restored.
  onChanged: (updated: PostingDetail) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [said, setSaid] = useState('')
  // Each document's sections, which name where a fix's change is; read once there are fixes.
  // Null until first read, so cards aren't named one way and then another.
  const [sections, setSections] = useState<Partial<Record<ReviewedDoc, TreeSection[]>> | null>(null)
  const errorId = useId()
  const focusLater = useFocusLater()
  const review = posting.final_review
  const linkTo = (kind: ReviewedDoc) => posting.versions.find((use) => use.kind === kind)
  const hasFixes = Boolean(review?.findings.some((finding) => finding.fixes.length > 0))
  const versionKey = posting.versions.map((use) => `${use.kind}:${use.id}`).join(',')

  // Read again after each change to a fix, since applying or undoing one changes its document.
  // One that can't be read leaves its fixes named by their section alone ("in a section").
  // From versionKey ("resume:11,cover_letter:12"), since posting.versions is a new array on every
  // read of the posting.
  const loadSections = useCallback(async () => {
    const docs = versionKey
      .split(',')
      .map((part) => part.split(':'))
      .filter(([kind]) => kind === 'resume' || kind === 'cover_letter')
      .map(([kind, docId]) => ({ kind: kind as ReviewedDoc, id: Number(docId) }))
    const read = await Promise.all(
      docs.map(async ({ kind, id }) => {
        try {
          return [kind, (await docsApi(kind).get(id)).sections] as const
        } catch {
          return [kind, []] as const
        }
      }),
    )
    setSections(Object.fromEntries(read))
  }, [versionKey])

  useEffect(() => {
    if (hasFixes) void loadSections()
  }, [hasFixes, loadSections])

  if (posting.versions.length === 0 && !review) return null

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    setSaid('Claude is reviewing them together…')
    try {
      onReviewed(await postingsApi.review(posting.job_posting_id))
      setSaid('')
    } catch (caught) {
      setError(toApiError(caught))
      setSaid('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Disclosure title="Review together" heading={3}>
      {review ? (
        <p className="muted">Reviewed on {showDay(review.reviewed_at)}.</p>
      ) : (
        <p className="muted">Not reviewed yet.</p>
      )}
      {review?.out_of_date && <p className="note">The resume or cover letter changed since this review.</p>}
      <div className="actions">
        {/* aria-disabled, not disabled, so the button keeps focus while Claude reviews. */}
        <button type="button" aria-disabled={busy} aria-describedby={error ? errorId : undefined} onClick={() => void run()}>
          {busy ? 'Reviewing…' : review ? 'Review again' : 'Review now'}
        </button>
      </div>
      {error && (
        <p role="alert" id={errorId}>
          {error.message}
        </p>
      )}
      <p aria-live="polite" className="visually-hidden">
        {said}
      </p>

      {review && (
        <>
          <h4>Keywords ({review.keywords.length})</h4>
          {review.keywords.length === 0 ? (
            <p className="muted">None found in the posting.</p>
          ) : (
            <ul aria-label="Keywords">
              {review.keywords.map((keyword) => (
                <li key={keyword.term}>
                  <strong>{keyword.term}</strong>: {COVERED[keyword.covered_by]}
                  {keyword.where && `, in ${keyword.where}`}
                </li>
              ))}
            </ul>
          )}

          <h4>Findings ({review.findings.length})</h4>
          {!review.checked && (
            <p className="note">Claude couldn't check these fixes against your writing rules, so nothing in them is flagged.</p>
          )}
          {review.findings.length === 0 && <p className="muted">Nothing to fix.</p>}
          {posting.locked && hasFixes && <p className="note">You applied to this posting, so its fixes can't be applied.</p>}
          {GROUPS.map(({ kind, title }) => {
            const found = review.findings.filter((finding) => finding.kind === kind)
            if (found.length === 0) return null
            return (
              <div key={kind}>
                <h5>
                  {title} ({found.length})
                </h5>
                <ul aria-label={title}>
                  {found.map((finding) => (
                    <li key={finding.id}>
                      <p>
                        <strong>{finding.where}</strong>
                      </p>
                      <p>{finding.why}</p>
                      <p>
                        In:{' '}
                        {finding.documents.map((doc, index) => {
                          const use = linkTo(doc)
                          return (
                            <span key={doc}>
                              {index > 0 && ', '}
                              {use ? (
                                <Link
                                  to={`${KINDS[doc].path}/${use.id}`}
                                  state={{ back: `/postings/${posting.job_posting_id}` } satisfies ListState}
                                  aria-label={`${docName(doc)}: ${finding.where}`}
                                >
                                  {docName(doc)}
                                </Link>
                              ) : (
                                docName(doc)
                              )}
                            </span>
                          )
                        })}
                      </p>
                      {finding.fixes.length > 0 && !sections && <p>Loading the fixes…</p>}
                      {finding.fixes.length > 0 && sections && (
                        <ul aria-label={`Fixes for ${finding.where}`} className={cardStyles.cards}>
                          {finding.fixes.map((fix) => {
                            const title = describe(fix.proposal, sections?.[fix.document] ?? [])
                            const id = posting.job_posting_id
                            const changed = async (updated: PostingDetail, message: string) => {
                              onChanged(updated)
                              setSaid(message)
                              await loadSections()
                              // Its buttons change, so focus stays on the card.
                              focusLater(fixId(fix))
                            }
                            return (
                              <li key={fix.proposal.id} id={fixId(fix)} tabIndex={-1} className={cardStyles.card}>
                                <p className="muted">In the {KINDS[fix.document].singular}</p>
                                <ProposalCard
                                  proposal={fix.proposal}
                                  title={title}
                                  singular={KINDS[fix.document].singular}
                                  readOnly={posting.locked}
                                  onApply={async () => {
                                    const applied = await postingsApi.applyFix(id, fix.proposal.id)
                                    await changed(applied.posting, `Applied: ${title}.${staleNote(applied.stale)}`)
                                  }}
                                  onUndo={
                                    fix.can_undo
                                      ? async () => changed(await postingsApi.undoFix(id, fix.proposal.id), `Undid: ${title}.`)
                                      : undefined
                                  }
                                  onState={async (state) =>
                                    changed(
                                      await postingsApi.setFixState(id, fix.proposal.id, state),
                                      state === 'dismissed' ? `Dismissed: ${title}.` : `Restored: ${title}.`,
                                    )
                                  }
                                />
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
    </Disclosure>
  )
}
