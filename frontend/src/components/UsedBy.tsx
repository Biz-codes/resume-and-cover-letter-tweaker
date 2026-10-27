import { KIND_LABELS, type Use } from '../api/usage'
import Collapsible from './Collapsible'

export default function UsedBy({ uses }: { uses: Use[] }) {
  return (
    <Collapsible title="Used by" count={uses.length}>
      {uses.length === 0 ? (
        <p className="muted">Not used yet.</p>
      ) : (
        <ul className="uses">
          {uses.map((use) => (
            <li key={`${use.kind}-${use.id}`}>
              {KIND_LABELS[use.kind]}: {use.name}
              {use.locked && <span className="tag">sent</span>}
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  )
}
