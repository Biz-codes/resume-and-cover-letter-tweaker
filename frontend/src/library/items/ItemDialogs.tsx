// The dialog a library page edits its items in (Dialog), showing one item at a time with that
// kind's view. A name inside it (a bullet under a role, a role that lists a bullet) shows that
// item in the same dialog, never a second one, with "Back to [the item before]"; Close closes the
// whole dialog, and focus goes back to where it was first opened. Each view reads what it needs,
// and tells the page (`reload`, `notify`) when something changed.
import { useCallback, useState } from 'react'
import Dialog from '../../shared/components/Dialog/Dialog'
import { PAGE_HEADING_ID, useFocusLater } from '../../shared/hooks/useFocusLater'
import { DIALOG_HEADING_ID, editId, ItemHostContext, type ItemHost, type ItemRef } from './itemHost'
import ItemView from './ItemView'

export function useItemDialogs({
  reload,
  notify,
}: {
  // Reads the page's lists again.
  reload: () => Promise<unknown>
  // Sets the page's notice.
  notify: (notice: string | null) => void
}) {
  // The items shown, the first one opened from the page and each next one from a name inside.
  const [stack, setStack] = useState<ItemRef[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const focusLater = useFocusLater()

  const open = useCallback(
    (ref: ItemRef) => {
      setStack([ref])
      setNotice(null)
      notify(null)
    },
    [notify],
  )

  const host: ItemHost = {
    open: (ref) => {
      setStack((shown) => [...shown, ref])
      setNotice(null)
    },
    refresh: async () => {
      await reload()
    },
    // The notice is set once the dialog is gone, so it's announced on a page that can be reached.
    saved: async (message, item) => {
      setStack([])
      await reload()
      notify(message)
      focusLater(editId(item.kind, item.id))
    },
    deleted: async (message) => {
      setStack([])
      focusLater(PAGE_HEADING_ID)
      await reload()
      notify(message)
    },
    say: setNotice,
    close: () => setStack([]),
  }

  const top = stack.at(-1)
  const before = stack.at(-2)
  const dialog = top && (
    <ItemHostContext.Provider value={host}>
      <Dialog
        title={top.title}
        headingId={DIALOG_HEADING_ID}
        showing={`${stack.length}-${top.kind}-${top.id}`}
        notice={notice}
        onClose={() => setStack([])}
      >
        {before && (
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                setStack((shown) => shown.slice(0, -1))
                setNotice(null)
              }}
            >
              Back to {before.title}
            </button>
          </div>
        )}
        <ItemView key={`${stack.length}-${top.kind}-${top.id}`} kind={top.kind} id={top.id} />
      </Dialog>
    </ItemHostContext.Provider>
  )

  return { open, dialog }
}
