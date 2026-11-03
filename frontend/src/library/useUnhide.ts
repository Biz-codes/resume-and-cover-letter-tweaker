// Unhide on a library page's hidden card (HiddenItems): save it, read the page again, say so in the
// page's notice, and move focus to the item's View and Edit button, now in the page's other groups.
import { useCallback } from 'react'
import { useFocusLater } from '../shared/hooks/useFocusLater'
import { editId, type ItemKind } from './items/itemHost'

export function useUnhide(load: () => Promise<unknown>, notify: (notice: string | null) => void) {
  const focusLater = useFocusLater()
  return useCallback(
    async (kind: ItemKind, id: number, name: string, save: () => Promise<unknown>) => {
      await save()
      await load()
      notify(`Unhid "${name}".`)
      focusLater(editId(kind, id))
    },
    [load, notify, focusLater],
  )
}
