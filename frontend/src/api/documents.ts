// Resumes and cover letters, which share one shape here so the same pages show either kind.
// See backend/app/routers/resumes.py and cover_letters.py, and "Versions" and "Sent versions
// are locked" in docs/FRONTEND_CHECKS.md.
import { api } from './client'
import type { HeaderFields } from './headers'
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

// The kinds of item placed directly in a section, which can mix in any order.
export type EntryKind = 'narrative' | 'category' | 'experience' | 'project' | 'bullet' | 'education'

// A skill under a category or project, or a bullet under a role or project.
export interface TreeChild {
  row_id: number
  item_id: number
  position: number
  text: string
}

// An item placed directly in a section. row_id is its row in this document, which the calls
// below take; item_id is the library item.
export interface TreeEntry {
  kind: EntryKind
  row_id: number
  item_id: number
  position: number
  // The library values it prints: content, category_name, role_title, organization, location,
  // dates, project_title, done_for, url, degree, institution, details, or graduation.
  values: Record<string, string | null>
  skills: TreeChild[]
  bullets: TreeChild[]
}

// A new library item written in a section: its kind, and that kind's fields (content for
// narrative content and bullets; role_title, organization, location, and dates for a role; and so
// on, as in the library's own forms).
export type NewItem = { kind: EntryKind } & Record<string, string | null>

export interface TreeSection {
  row_id: number
  section_id: number
  title: string
  entries: TreeEntry[]
}

export interface DocDetail extends Doc {
  // Its sections in order, each with its items in order.
  sections: TreeSection[]
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
    // A new base version. Only the name is sent, so the backend fills in the defaults: the most
    // recently used header, for a letter "Hiring Team" and "Sincerely", and the sections (each
    // with its items) of the latest document of the same kind.
    create: (name: string) => one(api.post<Raw>(path, { name })),
    // A sent version can only be renamed (VERSION_LOCKED otherwise).
    update: (id: number, fields: DocFields) => one(api.put<Raw>(`${path}/${id}`, fields)),
    // A new base version with the original's fields, sections, and selections.
    copy: (id: number, name: string) => one(api.post<Raw>(`${path}/${id}/copies`, { name })),
    delete: (id: number) => api.delete(`${path}/${id}`),

    // Building the header and tree (backend/app/routers/document_tree.py). Each call sends the whole list in
    // its new order and returns the document with its new tree and output. Rows left out are
    // removed with everything under them. A sent version returns VERSION_LOCKED.
    // The header's values, each picked or typed on its own: the document points at the saved header
    // with exactly these values, or a new one. No saved header changes.
    setHeader: (id: number, fields: HeaderFields) => one(api.put<Raw>(`${path}/${id}/header`, fields)),
    // A section added starts with its default items, each with its defaults.
    setSections: (id: number, sectionIds: number[]) =>
      one(api.put<Raw>(`${path}/${id}/sections`, { section_ids: sectionIds })),
    // Saved items, placed last in the section in this order. Leaving out an item's skill_ids or
    // bullet_ids gives it its defaults (what the latest document showed with it, or the first few
    // it lists); an empty list shows none.
    placeItems: (
      id: number,
      sectionRow: number,
      items: { kind: EntryKind; item_id: number; skill_ids?: number[]; bullet_ids?: number[] }[],
    ) => one(api.post<Raw>(`${path}/${id}/sections/${sectionRow}/items`, { items })),
    setItems: (id: number, sectionRow: number, entries: { kind: EntryKind; item_id: number }[]) =>
      one(api.put<Raw>(`${path}/${id}/sections/${sectionRow}/items`, { entries })),
    // A category's skills must be ones it lists (VALIDATION_FAILED otherwise).
    setSkills: (id: number, entryKind: 'category' | 'project', entryRow: number, skillIds: number[]) =>
      one(api.put<Raw>(`${path}/${id}/items/${entryKind}/${entryRow}/skills`, { skill_ids: skillIds })),
    // Only bullets the role or project lists (VALIDATION_FAILED), and each once per section (DUPLICATE).
    setBullets: (id: number, entryKind: 'experience' | 'project', entryRow: number, bulletIds: number[]) =>
      one(api.put<Raw>(`${path}/${id}/items/${entryKind}/${entryRow}/bullets`, { bullet_ids: bulletIds })),
    // A new library item of any kind, with its own fields: saved to the library, listed under the
    // section, and placed last in it. A skill category's name must be new (DUPLICATE).
    // With `replaces`, a new version of narrative content or a bullet placed in the section: listed
    // right after the original, and in its place here.
    write: (id: number, sectionRow: number, item: NewItem, replaces?: number) =>
      one(api.post<Raw>(`${path}/${id}/sections/${sectionRow}/written`, { ...item, replaces })),
    // A new bullet: saved to the library, listed under the role or project, and shown last under it.
    // With `replaces`, a new version of a bullet shown under it, listed right after the original
    // and in its place here.
    writeBullet: (
      id: number,
      entryKind: 'experience' | 'project',
      entryRow: number,
      content: string,
      replaces?: number,
    ) => one(api.post<Raw>(`${path}/${id}/items/${entryKind}/${entryRow}/written`, { content, replaces })),
    // A new skill: saved to the library, listed under the category (a project's under "Other" and
    // the project), and shown last under it. Its name must be new (DUPLICATE).
    writeSkill: (id: number, entryKind: 'category' | 'project', entryRow: number, skillName: string) =>
      one(api.post<Raw>(`${path}/${id}/items/${entryKind}/${entryRow}/skills/written`, { skill_name: skillName })),
  }
}
