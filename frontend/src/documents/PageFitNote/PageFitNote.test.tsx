import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PageFit } from '../../shared/api/documents'
import { expectNoA11yViolations } from '../../test/axe'
import PageFitNote from './PageFitNote'

const FITS: PageFit = { limit: 2, pages: 1.8, fits: true, page_starts: ['Projects'], too_long: [], spare_lines: 10 }

describe('PageFitNote', () => {
  it('says it fits, with the estimate and where each page starts', async () => {
    const { container } = render(<PageFitNote fit={FITS} />)
    expect(container).toHaveTextContent('Fits on 2 pages. About 1.8 pages. Page 2 starts with Projects.')
    // Only whether it fits is announced as it changes.
    expect(screen.getByText('Fits on 2 pages.')).toHaveAttribute('aria-live', 'polite')
    await expectNoA11yViolations()
  })

  it('says by how much it is over', async () => {
    const { container } = render(
      <PageFitNote fit={{ ...FITS, pages: 2.3, fits: false, page_starts: ['Experience', 'Education'], spare_lines: -15 }} />,
    )
    expect(container).toHaveTextContent(
      "Doesn't fit on 2 pages. About 2.3 pages, 15 lines over. Page 2 starts with Experience. Page 3 starts with Education.",
    )
    await expectNoA11yViolations()
  })

  it("says it's Claude's draft during the review", async () => {
    const { container, rerender } = render(<PageFitNote fit={FITS} draft />)
    expect(container).toHaveTextContent('This draft fits on 2 pages. About 1.8 pages.')
    expect(screen.getByText('This draft fits on 2 pages.')).toHaveAttribute('aria-live', 'polite')
    await expectNoA11yViolations()
    rerender(<PageFitNote fit={{ ...FITS, fits: false, pages: 2.1, spare_lines: -4 }} draft />)
    expect(container).toHaveTextContent("This draft doesn't fit on 2 pages. About 2.1 pages, 4 lines over.")
  })

  it('names a section too long for one page', () => {
    const { container } = render(<PageFitNote fit={{ ...FITS, fits: false, too_long: ['Experience'] }} />)
    expect(container).toHaveTextContent('Experience is too long for one page, so it would split across the break.')
  })

  it("names several, and a letter's one page", () => {
    const { container } = render(
      <PageFitNote fit={{ limit: 1, pages: 1, fits: false, page_starts: [], too_long: ['Experience', 'Projects'], spare_lines: -1 }} />,
    )
    expect(container).toHaveTextContent("Doesn't fit on 1 page. About 1 page, 1 line over.")
    expect(container).toHaveTextContent('Experience, Projects are too long for one page, so each would split across the break.')
  })
})
