// Telling versions apart in a list (docs/FRONTEND_CHECKS.md, "Telling versions apart"): when two
// items in one list would read the same (two versions of a role with the same title, two headers
// with the same headline), each adds when it was added.

// "Oct 31, 2026, 2:05:13 PM", with seconds, since two versions can be saved in the same minute.
export const addedOn = (createdAt: string) =>
  new Date(createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' })

// Each item's label, with ", added …" on the ones whose label another item in `items` shares
// (ignoring capitals).
export function distinctLabels<T>(items: T[], label: (item: T) => string, createdAt: (item: T) => string) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = label(item).toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return (item: T) => {
    const text = label(item)
    return (counts.get(text.toLowerCase()) ?? 0) > 1 ? `${text}, added ${addedOn(createdAt(item))}` : text
  }
}
