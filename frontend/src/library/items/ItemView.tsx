// The view in a library dialog for each kind of item.
import BulletItem from './BulletItem'
import CategoryItem from './CategoryItem'
import EducationItem from './EducationItem'
import ExperienceItem from './ExperienceItem'
import HeaderItem from './HeaderItem'
import NarrativeItem from './NarrativeItem'
import ProjectItem from './ProjectItem'
import SectionItem from './SectionItem'
import SignOffItem from './SignOffItem'
import SkillItem from './SkillItem'
import ToneItem from './ToneItem'
import type { ItemKind } from './itemHost'

export default function ItemView({ kind, id }: { kind: ItemKind; id: number }) {
  switch (kind) {
    case 'header':
      return <HeaderItem id={id} />
    case 'section':
      return <SectionItem id={id} />
    case 'narrative':
      return <NarrativeItem id={id} />
    case 'category':
      return <CategoryItem id={id} />
    case 'skill':
      return <SkillItem id={id} />
    case 'experience':
      return <ExperienceItem id={id} />
    case 'project':
      return <ProjectItem id={id} />
    case 'bullet':
      return <BulletItem id={id} />
    case 'education':
      return <EducationItem id={id} />
    case 'signOff':
      return <SignOffItem id={id} />
    case 'tone':
      return <ToneItem id={id} />
  }
}
