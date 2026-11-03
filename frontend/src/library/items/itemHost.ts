// What a library item's dialog contents (the views in this folder) can ask of the dialog showing
// them (useItemDialogs): show another item in its place, keep the page in step, and close with
// a notice on the page. Kept apart from ItemDialogs.tsx, which imports every view.
import { createContext, useContext } from 'react'

export type ItemKind =
  | 'header'
  | 'section'
  | 'narrative'
  | 'category'
  | 'skill'
  | 'experience'
  | 'project'
  | 'bullet'
  | 'education'
  | 'signOff'
  | 'tone'

// Values a new version is saved with, by field name (empty fields as null).
export type VersionValues = Record<string, string | null>

// Where an item opened from a row of a resume's or cover letter's tree is placed. Its New version
// takes its place there only (docs/FRONTEND_CHECKS.md, "New versions in a resume or cover letter").
export interface Placement {
  // "resume" or "cover letter".
  doc: string
  // The row's View and Edit button, where focus goes when the dialog closes after a change.
  returnTo: string
  // Saves the new version in the item's place, and gives the notice for the page.
  version: (values: VersionValues) => Promise<string>
}

// An item to show, with the title its dialog is named by.
export interface ItemRef {
  kind: ItemKind
  id: number
  title: string
}

export interface ItemHost {
  // Shows another item in the same dialog, with Back to this one.
  open: (ref: ItemRef) => void
  // After a change that keeps the dialog open: the page reads its lists again.
  refresh: () => Promise<void>
  // Closes the dialog, then says `message` on the page and moves focus to the saved item's Edit
  // button, when the page shows it (otherwise focus goes back to what opened the dialog).
  saved: (message: string, item: { kind: ItemKind; id: number }) => Promise<void>
  // Closes the dialog, then says `message` on the page, with focus on the page heading.
  deleted: (message: string) => Promise<void>
  // Says `message` in the dialog, for a change that keeps it open.
  say: (message: string) => void
  close: () => void
  // Set only for the item opened from a tree row, not one shown from a name inside the dialog:
  // what it's placed in, and New version, which saves the version in its place there and closes
  // the dialog with a notice on the page.
  placed?: { doc: string; version: (values: VersionValues) => Promise<void> }
}

// The note on a placed item's New version form.
export const placedNote = (doc: string) => `It takes the original's place in this ${doc} only. The original stays in your library.`

export const ItemHostContext = createContext<ItemHost | null>(null)

export function useItemHost() {
  const host = useContext(ItemHostContext)
  if (!host) throw new Error('useItemHost needs useItemDialogs above it.')
  return host
}

// The host, or none outside a dialog (a list shown on its own), where names don't open items.
export const useOptionalItemHost = () => useContext(ItemHostContext)

// Each card's View and Edit button, where focus returns when the dialog closes after a save.
export const editId = (kind: ItemKind, id: number) => `${kind}-${id}-edit`

// The dialog's heading, where focus goes after something inside it is removed.
export const DIALOG_HEADING_ID = 'item-dialog-heading'
