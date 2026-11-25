import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, describe as group, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import { errorBody, stubApi, stubPendingApi } from '../test/stubApi'
import FinalReview, { reviewedNotice } from './FinalReview'
import type { Proposal } from '../shared/api/chat'
import type { FinalReview as Review, Fix, PostingDetail } from './postings'

const POSTING: PostingDetail = {
  job_posting_id: 9,
  url: 'https://example.com/jobs/9',
  organization: 'Acme',
  role_title: 'Engineer',
  description: 'Build things.',
  header_id: 2,
  applied_on: null,
  locked: false,
  hidden: false,
  versions: [
    { kind: 'resume', id: 11, name: 'Engineer at Acme', locked: false },
    { kind: 'cover_letter', id: 12, name: 'Engineer at Acme', locked: false },
  ],
  updated_at: null,
  suggested_header: null,
  lone_interviews: 0,
  rejected_on: null,
  hired_on: null,
  contacts: null,
  interviews: [],
  same_organization: [],
  final_review: null,
}

const REVIEW: Review = {
  keywords: [
    { term: 'React', covered_by: 'both', where: 'Experience: Shipped it' },
    { term: 'Go', covered_by: 'neither', where: '' },
  ],
  findings: [
    { id: 'finding_1', kind: 'repeated', documents: ['resume', 'cover_letter'], where: 'Experience: Shipped it', why: 'Both say it the same way.', fixes: [] },
    { id: 'finding_2', kind: 'keyword', documents: ['resume'], where: 'Skills', why: 'Nothing shows Go.', fixes: [] },
  ],
  checked: true,
  reviewed_at: '2026-11-18T12:00:00Z',
  out_of_date: false,
}

function renderReview(posting: PostingDetail = POSTING, onReviewed = vi.fn()) {
  render(
    <MemoryRouter>
      <FinalReview posting={posting} onReviewed={onReviewed} onChanged={vi.fn()} />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Review together' }))
  return onReviewed
}

describe('FinalReview', () => {
  it('shows nothing for a posting with no resume or cover letter', () => {
    const { container } = render(
      <MemoryRouter>
        <FinalReview posting={{ ...POSTING, versions: [] }} onReviewed={vi.fn()} onChanged={vi.fn()} />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('offers a review, saying it is reviewing while it waits', async () => {
    stubPendingApi()
    renderReview()
    expect(screen.getByText('Not reviewed yet.')).toBeInTheDocument()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Review now' }))
    const reviewing = await screen.findByRole('button', { name: 'Reviewing…' })
    expect(reviewing).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Claude is reviewing them together…')).toHaveAttribute('aria-live', 'polite')
    await expectNoA11yViolations()
  })

  it('offers a review for a posting applied to that was never reviewed, keeping focus while it waits', async () => {
    stubPendingApi()
    renderReview({ ...POSTING, locked: true })
    const button = screen.getByRole('button', { name: 'Review now' })
    button.focus()
    fireEvent.click(button)
    const reviewing = await screen.findByRole('button', { name: 'Reviewing…' })
    expect(reviewing).toHaveFocus()
    expect(screen.getByText('Claude is reviewing them together…')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('gives the page the posting with its review once it is done', async () => {
    const reviewed = { ...POSTING, final_review: REVIEW }
    stubApi({ 'POST /api/job-postings/9/review': [{ status: 200, body: reviewed }] })
    const onReviewed = renderReview()
    fireEvent.click(screen.getByRole('button', { name: 'Review now' }))
    await vi.waitFor(() => expect(onReviewed).toHaveBeenCalledWith(reviewed))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Review now' })).toHaveAttribute('aria-disabled', 'false'))
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('')
  })

  it('says why it could not review, read with the button', async () => {
    stubApi({
      'POST /api/job-postings/9/review': [{ status: 422, body: errorBody('VALIDATION_FAILED', "Approve Claude's first draft of the resume first.") }],
    })
    renderReview()
    fireEvent.click(screen.getByRole('button', { name: 'Review now' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Approve Claude's first draft of the resume first.")
    expect(screen.getByRole('button', { name: 'Review now' })).toHaveAccessibleDescription(
      "Approve Claude's first draft of the resume first.",
    )
    await expectNoA11yViolations()
  })

  it('shows the keywords and the findings by kind, each linking to its document', async () => {
    renderReview({ ...POSTING, final_review: REVIEW })
    expect(screen.getByText('Reviewed on November 18, 2026.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review again' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Keywords' })).toHaveTextContent('React: both, in Experience: Shipped itGo: not covered')
    expect(screen.getByRole('heading', { level: 4, name: 'Findings (2)' })).toBeInTheDocument()
    const repeated = screen.getByRole('list', { name: 'Repeated wording' })
    expect(repeated).toHaveTextContent('Both say it the same way.')
    expect(within(repeated).getByRole('link', { name: 'Resume: Experience: Shipped it' })).toHaveAttribute('href', '/resumes/11')
    expect(within(repeated).getByRole('link', { name: 'Cover letter: Experience: Shipped it' })).toHaveAttribute('href', '/cover-letters/12')
    expect(screen.getByRole('heading', { level: 5, name: 'Keywords they miss (1)' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Inconsistencies/ })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('says when it is out of date, and when there is nothing to fix', async () => {
    renderReview({ ...POSTING, final_review: { ...REVIEW, findings: [], keywords: [], out_of_date: true } })
    expect(screen.getByText('The resume or cover letter changed since this review.')).toBeInTheDocument()
    expect(screen.getByText('Nothing to fix.')).toBeInTheDocument()
    expect(screen.getByText('None found in the posting.')).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("reviews a posting applied to as well, and names a document it no longer has", async () => {
    renderReview({ ...POSTING, locked: true, versions: [POSTING.versions[0]], final_review: REVIEW })
    expect(screen.getByRole('button', { name: 'Review again' })).toBeInTheDocument()
    expect(screen.getByText('Reviewed on November 18, 2026.')).toBeInTheDocument()
    const repeated = screen.getByRole('list', { name: 'Repeated wording' })
    expect(within(repeated).queryByRole('link', { name: /^Cover letter/ })).not.toBeInTheDocument()
    expect(repeated).toHaveTextContent('In: Resume, Cover letter')
    await expectNoA11yViolations()
  })

  group('fixes', () => {
    const PROPOSAL = {
      id: 'finding_1_fix_1',
      action: 'reword' as const,
      target: 'bullet' as const,
      section_id: 3,
      item_id: 8,
      parent_kind: 'experience' as const,
      parent_id: 7,
      new_text: 'Shipped it weekly.',
      position: 0,
      reason: 'Says it once.',
      before: 'Shipped it',
      state: 'pending' as const,
      checked: true,
    }
    const withFix = (fix: Partial<Omit<Fix, 'proposal'>> & { proposal?: Partial<Proposal> } = {}, review: Partial<Review> = {}): PostingDetail => ({
      ...POSTING,
      final_review: {
        ...REVIEW,
        ...review,
        findings: [{ ...REVIEW.findings[0], fixes: [{ document: 'resume', can_undo: false, ...fix, proposal: { ...PROPOSAL, ...fix.proposal } }] }],
      },
    })
    const SECTIONS = [{ row_id: 1, section_id: 3, title: 'Experience', entries: [] }]
    const docs = {
      'GET /api/resumes/11': [{ status: 200, body: { resume_id: 11, sections: SECTIONS } }],
      'GET /api/cover-letters/12': [{ status: 200, body: { letter_id: 12, sections: [] } }],
    }
    const TITLE = 'Reword the bullet "Shipped it" in Experience'

    function renderFixes(posting: PostingDetail, onChanged = vi.fn()) {
      render(
        <MemoryRouter>
          <FinalReview posting={posting} onReviewed={vi.fn()} onChanged={onChanged} />
        </MemoryRouter>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Review together' }))
      return onChanged
    }
    const announced = () => document.querySelector('[aria-live="polite"]')?.textContent

    it('says it is loading the fixes until both documents are read', async () => {
      stubPendingApi()
      renderFixes(withFix())
      expect(screen.getByText('Loading the fixes…')).toBeInTheDocument()
      expect(screen.queryByRole('list', { name: /^Fixes for/ })).not.toBeInTheDocument()
      await expectNoA11yViolations()
    })

    it("shows each fix as a card named for where it is, with its document, flags, and page mark", async () => {
      stubApi(docs)
      renderFixes(
        withFix(
          { proposal: { flags: [{ kind: 'pattern', rule: 'em dashes used for drama', quote: '—', why: 'Drama.' }], page: { limit: 2, pages: 2.1, over_lines: 3, too_long: [] } } },
          { checked: false },
        ),
      )
      const fixes = await screen.findByRole('list', { name: 'Fixes for Experience: Shipped it' })
      await within(fixes).findByRole('button', { name: `Apply: ${TITLE}` })
      expect(fixes).toHaveTextContent('In the resume')
      expect(fixes).toHaveTextContent('Flagged')
      expect(fixes).toHaveTextContent('Would take the resume 3 lines over 2 pages.')
      expect(within(fixes).queryByRole('button', { name: /^Reply/ })).not.toBeInTheDocument()
      expect(screen.getByText("Claude couldn't check these fixes against your writing rules, so nothing in them is flagged.")).toBeInTheDocument()
      await expectNoA11yViolations()
    })

    it('applies a fix, saying so and how many went stale, keeping focus on its card', async () => {
      const applied = withFix({ can_undo: true, proposal: { state: 'applied' } })
      stubApi({
        ...docs,
        'POST /api/job-postings/9/review/fixes/finding_1_fix_1/apply': [{ status: 200, body: { posting: applied, stale: 1 } }],
      })
      const onChanged = vi.fn()
      render(
        <MemoryRouter>
          <FinalReview posting={withFix()} onReviewed={vi.fn()} onChanged={onChanged} />
        </MemoryRouter>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Review together' }))
      fireEvent.click(await screen.findByRole('button', { name: `Apply: ${TITLE}` }))
      await vi.waitFor(() => expect(announced()).toBe(`Applied: ${TITLE}. 1 other fix for the same content is now stale.`))
      expect(onChanged).toHaveBeenCalledWith(applied)
      await vi.waitFor(() => expect(document.getElementById('review-fix-finding_1_fix_1')).toHaveFocus())
    })

    it('offers Undo on an applied fix that can be undone, and says so once it is', async () => {
      stubApi({ ...docs, 'POST /api/job-postings/9/review/fixes/finding_1_fix_1/undo': [{ status: 200, body: withFix() }] })
      const onChanged = renderFixes(withFix({ can_undo: true, proposal: { state: 'applied' } }))
      fireEvent.click(await screen.findByRole('button', { name: `Undo: ${TITLE}` }))
      await vi.waitFor(() => expect(announced()).toBe(`Undid: ${TITLE}.`))
      expect(onChanged).toHaveBeenCalledWith(withFix())
      await expectNoA11yViolations()
    })

    it("has no Undo once its document changed, and nothing to do once it's applied to", async () => {
      stubApi(docs)
      renderFixes(withFix({ can_undo: false, proposal: { state: 'applied' } }))
      await screen.findByRole('list', { name: 'Fixes for Experience: Shipped it' })
      await vi.waitFor(() => expect(screen.getByText(TITLE)).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument()
    })

    it('dismisses and restores a fix, saying so, and says why one failed', async () => {
      stubApi({
        ...docs,
        'PUT /api/job-postings/9/review/fixes/finding_1_fix_1': [
          { status: 200, body: withFix({ proposal: { state: 'dismissed' } }) },
          { status: 409, body: errorBody('VERSION_LOCKED', 'This was sent.') },
        ],
      })
      renderFixes(withFix())
      fireEvent.click(await screen.findByRole('button', { name: `Dismiss: ${TITLE}` }))
      await vi.waitFor(() => expect(announced()).toBe(`Dismissed: ${TITLE}.`))
      fireEvent.click(screen.getByRole('button', { name: `Dismiss: ${TITLE}` }))
      expect(await screen.findByRole('alert')).toHaveTextContent('This was sent.')
      await expectNoA11yViolations()
    })

    it("dismisses a fix's writing flag, saying so", async () => {
      const drama = { kind: 'pattern' as const, rule: 'em dashes used for drama', quote: '—', why: 'Drama.' }
      stubApi({
        ...docs,
        'PUT /api/job-postings/9/review/fixes/finding_1_fix_1/flags': [
          { status: 200, body: withFix({ proposal: { flags: [{ ...drama, dismissed: true }] } }) },
        ],
      })
      const onChanged = renderFixes(withFix({ proposal: { flags: [drama] } }))
      fireEvent.click(await screen.findByRole('button', { name: `Dismiss flag "em dashes used for drama" on ${TITLE}` }))
      await vi.waitFor(() => expect(announced()).toBe(`Dismissed the flag "em dashes used for drama" on ${TITLE}.`))
      expect(onChanged.mock.calls.at(-1)![0].final_review.findings[0].fixes[0].proposal.flags[0].dismissed).toBe(true)
    })

    it("shows a posting applied to its fixes with no buttons", async () => {
      stubApi(docs)
      renderFixes({ ...withFix(), locked: true })
      const fixes = await screen.findByRole('list', { name: 'Fixes for Experience: Shipped it' })
      await vi.waitFor(() => expect(fixes).toHaveTextContent(TITLE))
      expect(within(fixes).queryByRole('button')).not.toBeInTheDocument()
      expect(screen.getByText("You applied to this posting, so its fixes can't be applied.")).toBeInTheDocument()
    })
  })

  it('says what the page notice says once it is done', () => {
    expect(reviewedNotice({ ...POSTING, final_review: REVIEW })).toBe('Reviewed the resume and cover letter together. 2 findings below.')
    expect(reviewedNotice({ ...POSTING, versions: [POSTING.versions[1]], final_review: { ...REVIEW, findings: [REVIEW.findings[0]] } })).toBe(
      'Reviewed the cover letter. 1 finding below.',
    )
    expect(reviewedNotice({ ...POSTING, final_review: { ...REVIEW, findings: [] } })).toBe(
      'Reviewed the resume and cover letter together. Nothing to fix.',
    )
  })
})
