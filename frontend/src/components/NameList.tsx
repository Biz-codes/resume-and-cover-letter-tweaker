// A read-only list of names in a library card (the categories a skill is in, the sections
// that list a role), in a Collapsible that shows the count.
import Collapsible from './Collapsible'

export default function NameList({ title, names }: { title: string; names: string[] }) {
  return (
    <Collapsible title={title} count={names.length}>
      {names.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="uses">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </Collapsible>
  )
}
