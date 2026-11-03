// Where an item is used: each resume, cover letter, or posting, linked to its page.
import { Link, useInRouterContext } from 'react-router'
import { KIND_LABELS, pathOf, type Use } from '../shared/api/usage'
import Collapsible from './Collapsible/Collapsible'

export default function UsedBy({ uses }: { uses: Use[] }) {
  // A plain link outside the app's router (a page rendered on its own, as in its tests).
  const inRouter = useInRouterContext()
  return (
    <Collapsible title="Used by" count={uses.length}>
      {uses.length === 0 ? (
        <p className="muted">Not used yet.</p>
      ) : (
        <ul className="uses">
          {uses.map((use) => (
            <li key={`${use.kind}-${use.id}`}>
              {KIND_LABELS[use.kind]}:{' '}
              {inRouter ? <Link to={pathOf(use)}>{use.name}</Link> : <a href={pathOf(use)}>{use.name}</a>}
              {use.locked && <span className="tag">sent</span>}
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  )
}
