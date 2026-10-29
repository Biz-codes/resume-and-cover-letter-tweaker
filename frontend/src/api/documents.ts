// Resumes and cover letters, which share one shape here so the same pages show either kind.
// See backend/app/routers/resumes.py and cover_letters.py, and "Versions" and "Sent versions
// are locked" in docs/FRONTEND_CHECKS.md.
import { api } from './client'
import type { Use } from './usage'

export type DocKind = 'resume' | 'cover_letter'

export interface DocFields {
  name: string
  header_id: number | null
  tone_set_id: number | null
  // Cover letters only.
  addressee?: string | null
  sign_off_id?: number | null
  signature_name?: string | null
}

export interface OutputPart {
  // What the part is, for the page only: a cover letter never prints its section titles.
  label: string
  text: string
}

export interface Doc extends DocFields {
  id: number
  job_posting: { job_posting_id: number; organization: string; role_title: string } | null
  based_on: { id: number; name: string } | null
  // Sent: its posting was applied to, so only its name can change.
  locked: boolean
  // Versions copied from it, which a delete keeps.
  copies: Use[]
  updated_at: string | null
}

export interface DocDetail extends Doc {
  // The document as plain text, in parts (header, each section, greeting, sign-off).
  output: { parts: OutputPart[]; text: string }
}

export interface KindInfo {
  // Where its pages live in the app, and its API path.
  path: string
  // "resume" / "cover letter", and the plural for headings ("Resumes").
  singular: string
  plural: string
  idKey: 'resume_id' | 'letter_id'
}

export const KINDS: Record<DocKind, KindInfo> = {
  resume: { path: '/resumes', singular: 'resume', plural: 'Resumes', idKey: 'resume_id' },
  cover_letter: { path: '/cover-letters', singular: 'cover letter', plural: 'Cover letters', idKey: 'letter_id' },
}

// The fields a details form edits: every field the kind has.
export function fieldsOf(kind: DocKind, doc: Doc): DocFields {
  const fields: DocFields = { name: doc.name, header_id: doc.header_id, tone_set_id: doc.tone_set_id }
  if (kind === 'cover_letter') {
    Object.assign(fields, {
      addressee: doc.addressee ?? null,
      sign_off_id: doc.sign_off_id ?? null,
      signature_name: doc.signature_name ?? null,
    })
  }
  return fields
}

type Raw = Omit<Doc, 'id'> & { resume_id?: number; letter_id?: number }

const withId = <T extends Doc>(kind: DocKind, raw: Raw) => ({ ...raw, id: raw[KINDS[kind].idKey] }) as T

export function docsApi(kind: DocKind) {
  const path = KINDS[kind].path
  const one = (request: Promise<Raw>) => request.then((raw) => withId<DocDetail>(kind, raw))
  return {
    // Most recently updated first.
    list: () => api.get<Raw[]>(path).then((list) => list.map((raw) => withId<Doc>(kind, raw))),
    get: (id: number) => one(api.get<Raw>(`${path}/${id}`)),
    // A new, empty base version. Only the name is sent, so the backend fills in the defaults:
    // the most recently used header, and for a letter "Hiring Team" and "Sincerely".
    create: (name: string) => one(api.post<Raw>(path, { name })),
    // A sent version can only be renamed (VERSION_LOCKED otherwise).
    update: (id: number, fields: DocFields) => one(api.put<Raw>(`${path}/${id}`, fields)),
    // A new base version with the original's fields, sections, and selections.
    copy: (id: number, name: string) => one(api.post<Raw>(`${path}/${id}/copies`, { name })),
    delete: (id: number) => api.delete(`${path}/${id}`),
  }
}
