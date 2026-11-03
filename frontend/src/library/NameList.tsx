// A read-only list of names in a library dialog (the categories a skill is in, the sections
// that list a role), in a Collapsible that shows the count. Given `refs`, each name is a button
// that shows that item in the same dialog.
import Collapsible from './Collapsible/Collapsible'
import { useOptionalItemHost, type ItemRef } from './items/itemHost'

export default function NameList({ title, names, refs }: { title: string; names?: string[]; refs?: ItemRef[] }) {
  const host = useOptionalItemHost()
  const count = refs?.length ?? names?.length ?? 0
  return (
    <Collapsible title={title} count={count}>
      {count === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="uses">
          {refs
            ? refs.map((ref) => (
                <li key={`${ref.kind}-${ref.id}`}>
                  {host ? (
                    <button type="button" className="link-button" onClick={() => host.open(ref)}>
                      {ref.title}
                    </button>
                  ) : (
                    ref.title
                  )}
                </li>
              ))
            : names?.map((name) => <li key={name}>{name}</li>)}
        </ul>
      )}
    </Collapsible>
  )
}
