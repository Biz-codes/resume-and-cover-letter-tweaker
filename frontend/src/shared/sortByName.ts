// The order of the library's lists (docs/FRONTEND_CHECKS.md, "Library order"): A to Z by the name
// each card shows, ignoring capitals and accents, with numbers in number order ("Step 2" before
// "Step 10"). Items with the same name keep the order they came in (oldest first), so versions
// of an item stay together.
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export function sortByName<T>(items: T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => collator.compare(nameOf(a), nameOf(b)))
}

// Said once on each library page, so the order is never a guess.
export const SORT_NOTE = 'Sorted A to Z.'
