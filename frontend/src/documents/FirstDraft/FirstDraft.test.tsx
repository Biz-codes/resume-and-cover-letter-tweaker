import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { DocKind, FirstDraft as Kept, FirstDraftRow } from '../../shared/api/documents'
import { expectNoA11yViolations } from '../../test/axe'
import FirstDraft from './FirstDraft'

const row = (name: string, source: FirstDraftRow['source'], more: Partial<FirstDraftRow> = {}): FirstDraftRow => ({
  name,
  source,
  reason: '',
  flags: [],
  rewording: null,
  ...more,
})

const FLAG = { kind: 'term' as const, rule: 'leverage', quote: 'Leveraged', why: 'Filler.' }

const KEPT: Kept = {
  starting_document: { id: 3, name: 'Tech Base Resume' },
  started_from: 'document',
  starting_reason: 'Closest to the posting.',
  checked: true,
  greeting: null,
  sections: [
    {
      ...row('Experience', 'original', { reason: 'Shows the work.' }),
      entries: [
        {
          ...row('Engineer, Acme', 'original'),
          kind: 'experience',
          skills: [],
          bullets: [
            row('Leveraged React to ship the redesign.', 'claude', {
              reason: 'Names the posting’s stack.',
              flags: [FLAG],
              rewording: { claude: 'Leveraged React to ship the redesign.', original: 'Led the redesign.', use_original: false },
            }),
            row('Cut load time in half.', 'library'),
          ],
        },
      ],
    },
    {
      ...row('Skills', 'library'),
      entries: [
        {
          ...row('Front End', 'library'),
          kind: 'category',
          skills: [row('React', 'original')],
          bullets: [],
        },
        {
          ...row('Builds accessible apps.', 'library', {
            rewording: { claude: 'Builds accessible React apps.', original: 'Builds accessible apps.', use_original: true },
          }),
          kind: 'narrative',
          skills: [],
          bullets: [],
        },
      ],
    },
    { ...row('Talks', 'library'), entries: [] },
  ],
}

// Under a heading, as in the side panel's tab, which names it.
function renderKept(kept: Kept = KEPT, kind: DocKind = 'resume') {
  render(
    <MemoryRouter>
      <section aria-labelledby="first-draft-heading">
        <h3 id="first-draft-heading">Claude&apos;s first draft</h3>
        <FirstDraft kind={kind} firstDraft={kept} />
      </section>
    </MemoryRouter>,
  )
}

async function openIt() {
  return screen.findByRole('region', { name: "Claude's first draft" })
}

function openRationale(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Rationale for ${name}` }))
}

describe('FirstDraft', () => {
  it('shows the approved draft read-only, its parts headed under the panel', async () => {
    renderKept()
    const dialog = await openIt()
    expect(within(dialog).getByRole('heading', { level: 4, name: 'Sections' })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Tech Base Resume' })).toHaveAttribute('href', '/resumes/3')
    expect(dialog).toHaveTextContent('Closest to the posting.')
    expect(dialog).not.toHaveTextContent(/couldn.t check/)
    // Each row has its badge, with nothing to change.
    const bullets = within(dialog).getByRole('list', { name: 'Bullets under Engineer, Acme in Experience' })
    // Its own rows, not the writing rules listed under one.
    const [claude, library] = [...bullets.children] as HTMLElement[]
    expect(claude).toHaveTextContent('Source: Claude')
    expect(claude).toHaveTextContent('Flagged')
    expect(
      within(claude).getByRole('list', { name: 'Writing rules "Leveraged React to ship the redesign." under Engineer, Acme in Experience breaks' }),
    ).toHaveTextContent('leverage: “Leveraged”. Filler.')
    expect(library).toHaveTextContent('Source: Library')
    expect(within(dialog).getByRole('list', { name: 'Skills under Front End in Skills' })).toHaveTextContent('ReactSource: Original')
    expect(within(dialog).queryByRole('button', { name: /Reject|Use / })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('list', { name: 'Items in Skills' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Nothing here.')
    await expectNoA11yViolations()
  })

  it("shows Claude's reason and the other wording, without switching", async () => {
    renderKept()
    const dialog = await openIt()
    const bullet = '"Leveraged React to ship the redesign." under Engineer, Acme in Experience'
    openRationale(bullet)
    expect(dialog).toHaveTextContent('Names the posting’s stack.')
    expect(dialog).toHaveTextContent('OriginalLed the redesign.')
    // Gone back to the original: Claude's suggestion is the other wording.
    openRationale('Text: "Builds accessible apps." in Skills')
    expect(dialog).toHaveTextContent("Claude's suggestionBuilds accessible React apps.")
    openRationale('section "Experience"')
    expect(dialog).toHaveTextContent('Shows the work.')
    expect(within(dialog).queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
    // A row with no reason and no rewording has no rationale.
    expect(screen.queryByRole('button', { name: 'Rationale for section "Talks"' })).not.toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it("says where Claude started from, and when the writing rules weren't checked", async () => {
    renderKept({ ...KEPT, starting_document: null, started_from: 'own', checked: false, sections: [] })
    const dialog = await openIt()
    expect(dialog).toHaveTextContent('Claude started from your resume. Closest to the posting.')
    expect(dialog).toHaveTextContent("Claude couldn't check this draft against your writing rules, so nothing in it is flagged.")
    expect(dialog).toHaveTextContent('No sections in the draft.')
    await expectNoA11yViolations()
  })

  it('says which tone Claude picked', async () => {
    renderKept({ ...KEPT, tone: { tone_set_id: 2, name: 'Technical', reason: 'The posting is about tools.' } })
    const dialog = await openIt()
    expect(dialog).toHaveTextContent('Claude picked the "Technical" tone. The posting is about tools.')
    await expectNoA11yViolations()
  })

  it("shows a cover letter's greeting, Claude's or the usual one", async () => {
    const greeting = { claude: 'Jordan Rivera', usual: 'Acme Hiring Team', reason: 'The posting names them.', use_default: false }
    renderKept({ ...KEPT, starting_document: null, started_from: 'library', greeting }, 'cover_letter')
    let dialog = await openIt()
    expect(dialog).toHaveTextContent('Claude started from your library.')
    const greetingList = within(dialog).getByRole('list', { name: 'Greeting' })
    expect(greetingList).toHaveTextContent('Dear Jordan Rivera,Source: Claude')
    openRationale('greeting')
    expect(dialog).toHaveTextContent('The posting names them.')
    expect(dialog).toHaveTextContent('Usual greetingDear Acme Hiring Team,')
    expect(within(dialog).getByRole('heading', { level: 4, name: 'Greeting' })).toBeInTheDocument()
    await expectNoA11yViolations()

    cleanup()
    renderKept({ ...KEPT, greeting: { ...greeting, use_default: true } }, 'cover_letter')
    dialog = await openIt()
    expect(within(dialog).getByRole('list', { name: 'Greeting' })).toHaveTextContent('Dear Acme Hiring Team,')
    expect(within(dialog).getByRole('list', { name: 'Greeting' })).not.toHaveTextContent('Source:')
  })
})
