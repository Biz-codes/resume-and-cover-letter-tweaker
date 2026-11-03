import type { Use } from '../shared/api/usage'

// The same library item with every use unsent, for tests that delete it: an item a sent version
// uses can't be deleted (docs/FRONTEND_CHECKS.md, "Hiding").
export const unsent = <T extends { used_by: Use[] }>(item: T): T => ({
  ...item,
  used_by: item.used_by.map((use) => ({ ...use, locked: false })),
})
