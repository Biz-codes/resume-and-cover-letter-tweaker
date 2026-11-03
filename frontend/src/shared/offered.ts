// What a picker offers (docs/FRONTEND_CHECKS.md, "Hiding"): every item but the hidden ones. `keep`
// keeps a hidden item that's already chosen there (a letter's current sign-off, a checked
// section), so a choice already made still shows.
export function offered<T extends { hidden?: boolean }>(items: T[], keep: (item: T) => boolean = () => false): T[] {
  return items.filter((item) => !item.hidden || keep(item))
}
