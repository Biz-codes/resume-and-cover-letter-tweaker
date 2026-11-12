// What a library item's dialog contents (the views in this folder) can ask of the dialog showing
// them (useItemDialogs): show another item in its place, keep the page in step, and close with
// a notice on the page. Kept apart from ItemDialogs.tsx, which imports every view.
import { createContext, useContext } from 'react'
import type { ChatAbout } from '../../shared/api/chat'

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

// Where an item opened from a row of a resume's or cover letter's tree is placed.
export interface Placement {
  // "resume" or "cover letter".
  doc: string
  // The resume or cover letter itself. Saving an edit there changes it for this one, with the
  // others in progress it's checked for (docs/FRONTEND_CHECKS.md, "Changing an item").
  where: { kind: 'resume' | 'cover_letter'; id: number }
  // The row's View and Edit button, where focus goes when the dialog closes after a change.
  returnTo: string
  // The document's chat with Claude, when it has one: what a question asked in the dialog is
  // about (the row), and what to call once one is sent, so the chat panel shows it too.
  chat?: { about: ChatAbout; onSent: () => void }
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
  // what it's placed in.
  placed?: Pick<Placement, 'doc' | 'where' | 'chat'>
}

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
