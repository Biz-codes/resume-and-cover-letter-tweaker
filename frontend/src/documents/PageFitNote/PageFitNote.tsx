// Whether a resume fits on two pages with no section split across the break, or a cover letter on
// one (backend/app/page_fit.py, an estimate from the user's formatting), under the document's title.
// During Claude's draft, it's the draft's estimate as the user has it (`draft`), so it changes as
// they reject things or switch wordings. The first sentence (fits or doesn't) is in a live region,
// so a change that tips it is heard; the estimate after it changes with nearly every edit, so it
// isn't announced.
import type { PageFit } from '../../shared/api/documents'

const pagesWord = (count: number) => (count === 1 ? '1 page' : `${count} pages`)
const linesWord = (count: number) => (count === 1 ? '1 line' : `${count} lines`)

export default function PageFitNote({ fit, draft = false }: { fit: PageFit; draft?: boolean }) {
  const verb = fit.fits ? 'fits' : "doesn't fit"
  const status = `${draft ? `This draft ${verb}` : verb[0].toUpperCase() + verb.slice(1)} on ${pagesWord(fit.limit)}.`
  const starts = fit.page_starts.map((label, index) => `Page ${index + 2} starts with ${label}.`).join(' ')
  return (
    <div className={fit.fits ? 'muted' : 'note'}>
      <p>
        <span aria-live="polite">{status}</span> About {fit.pages} {fit.pages === 1 ? 'page' : 'pages'}
        {fit.spare_lines < 0 ? `, ${linesWord(-fit.spare_lines)} over.` : '.'} {starts}
      </p>
      {fit.too_long.length > 0 && (
        <p>
          {fit.too_long.join(', ')} {fit.too_long.length === 1 ? 'is' : 'are'} too long for one page, so{' '}
          {fit.too_long.length === 1 ? 'it' : 'each'} would split across the break.
        </p>
      )}
    </div>
  )
}
