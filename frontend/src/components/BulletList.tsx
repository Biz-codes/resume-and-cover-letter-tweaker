// A role's, project's, or section's list of bullets: reorder them, take one out, add one from
// the library, or write a new one (listed here, last). Bullets taken out stay in the library.
import { shortBullet } from '../api/bullets'
import Collapsible from './Collapsible'
import NameForm from './NameForm'
import OrderedList from './OrderedList'

type BulletRef = { bullet_id: number; content: string }

const toItem = (bullet: BulletRef) => ({
  id: bullet.bullet_id,
  name: bullet.content,
  label: `"${shortBullet(bullet.content)}"`,
})

export default function BulletList({
  owner,
  title = 'Bullets',
  bullets,
  allBullets,
  onChange,
  onWrite,
}: {
  // Names the list and the new-bullet field, e.g. "Engineer, Acme".
  owner: string
  title?: string
  bullets: BulletRef[]
  // Every bullet in the library, to add from.
  allBullets: BulletRef[]
  onChange: (ids: number[]) => Promise<void>
  onWrite: (content: string) => Promise<void>
}) {
  return (
    <Collapsible title={title} count={bullets.length}>
      <OrderedList
        label={`${owner} bullets`}
        items={bullets.map(toItem)}
        choices={allBullets.map(toItem)}
        emptyText="No bullets yet."
        onChange={onChange}
      />
      <NameForm label={`New bullet for ${owner}`} field="content" submitLabel="Add bullet" multiline onSave={onWrite} />
    </Collapsible>
  )
}
