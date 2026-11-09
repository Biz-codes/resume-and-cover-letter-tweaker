// Starting a resume or cover letter from the user's own file or pasted text
// (backend/app/imports.py; docs/FRONTEND_CHECKS.md, "Reading an existing resume or cover letter").
// Claude reads it into sections and items, each matched against the library, for the user to
// correct; nothing is saved until the corrected items are sent back (docsApi's readExisting and
// saveImported).
import type { EntryKind } from './documents'
import type { HeaderFields } from './headers'

export type Values = Record<string, string | null>

export interface ImportedItem {
  // Its fields, named as in the library: title (a section), content, role_title, category_name,
  // skill_name, text (a sign-off), and so on.
  values: Values
  // The library has an identical one, which is reused.
  saved: boolean
  // A library item that looks like the same thing written differently, for the user to choose.
  similar: { id: number; name: string } | null
}

export interface ImportedEntry extends ImportedItem {
  kind: EntryKind
  skills: ImportedItem[]
  bullets: ImportedItem[]
}

export interface ImportedSection extends ImportedItem {
  entries: ImportedEntry[]
}

export interface Imported {
  header: HeaderFields | null
  header_saved: boolean
  sections: ImportedSection[]
  // Cover letters only.
  addressee: string | null
  sign_off: ImportedItem | null
  signature_name: string | null
}

// What's saved: each item is the library item the user chose (`item_id`), or else its values,
// reused when the library has an identical one and added when it doesn't.
export interface ItemIn {
  item_id: number | null
  values: Values
}

export interface ImportBody {
  // A base one's header; one for a posting uses the posting's.
  header: HeaderFields | null
  sections: (ItemIn & { entries: (ItemIn & { kind: EntryKind; skills: ItemIn[]; bullets: ItemIn[] })[] })[]
  addressee: string | null
  sign_off: ItemIn | null
  signature_name: string | null
}

export type Source = { file: File } | { text: string }

export type SourceHow = 'upload' | 'paste'

// The field each way's errors are about.
export const SOURCE_FIELD = { upload: 'file', paste: 'text' } as const

// What to read, or the error to show when there's nothing to read yet.
export function sourceOf(how: SourceHow, file: File | null, text: string, singular: string): Source | string {
  if (how === 'upload') return file ? { file } : `Choose a ${singular} file to upload.`
  return text.trim() ? { text } : `Paste the ${singular}'s text in.`
}

// The file's bytes as base64, as the backend takes them.
export function base64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}
