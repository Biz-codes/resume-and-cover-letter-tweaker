// Resumes and cover letters, which share one shape here so the same pages show either kind.
// See backend/app/routers/resumes.py and cover_letters.py, and "Versions" and "Sent versions
// are locked" in docs/FRONTEND_CHECKS.md.
import { api } from './client'
import type { HeaderFields } from './headers'
import { base64, type ImportBody, type Imported, type Source } from './imports'
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
  // Set aside: listed under Hidden and offered nowhere new ("Hiding").
  hidden: boolean
  // Versions copied from it, which a delete keeps.
  copies: Use[]
  updated_at: string | null
}

// A version for a job posting, which uses the posting's header. An applied posting returns
// VERSION_LOCKED, and one with no header VALIDATION_FAILED.
export interface ForPosting {
  job_posting_id: number
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

// Claude's draft of a posting's document, until its first review is finished
// (backend/app/drafts.py). Each piece of Claude's text is kept once in `texts`, and placed by its
// key; `use_original` goes back to the item's own wording. A reason is empty for what the user
// added during the review.
export interface DraftBullet {
  bullet_id: number | null
  text_key?: number | null
  use_original?: boolean
  reason?: string
}

export interface DraftEntry {
  kind: EntryKind
  // Null only for Claude's new narrative content or bullet.
  item_id: number | null
  text_key?: number | null
  use_original?: boolean
  reason?: string
  skill_ids?: number[]
  bullets?: DraftBullet[]
}

export interface DraftSection {
  section_id: number
  reason?: string
  entries: DraftEntry[]
}

// A rewording (of `replaces`) or new text Claude wrote.
export interface ClaudeText {
  key: number
  kind: 'narrative' | 'bullet'
  text: string
  replaces: number | null
}

export interface Draft {
  // The earlier one Claude started from, or null for none.
  starting_document: { id: number; name: string } | null
  starting_reason: string
  texts: ClaudeText[]
  sections: DraftSection[]
}

// The keys of Claude's texts the draft uses (not gone back to the original). The rest can be kept
// in the library for later when the review is finished.
export function textsInUse(sections: DraftSection[]) {
  const keys = new Set<number>()
  const add = (key: number | null | undefined, useOriginal: boolean | undefined) => {
    if (key != null && !useOriginal) keys.add(key)
  }
  for (const section of sections) {
    for (const entry of section.entries) {
      add(entry.text_key, entry.use_original)
      for (const bullet of entry.bullets ?? []) add(bullet.text_key, bullet.use_original)
    }
  }
  return keys
}

export interface DocDetail extends Doc {
  // Its sections in order, each with its items in order.
  sections: TreeSection[]
  // The document as plain text, in parts (header, each section, greeting, sign-off).
  output: { parts: OutputPart[]; text: string }
  draft: Draft | null
}

export interface KindInfo {
  // Where its pages live in the app, and its API path.
  path: string
  // "resume" / "cover letter", and the plural for headings ("Resumes").
  singular: string
  plural: string
  // "Resume" / "Cover Letter", ending a document's title.
  title: string
  idKey: 'resume_id' | 'letter_id'
}

export const KINDS: Record<DocKind, KindInfo> = {
  resume: { path: '/resumes', singular: 'resume', plural: 'Resumes', title: 'Resume', idKey: 'resume_id' },
  cover_letter: {
    path: '/cover-letters',
    singular: 'cover letter',
    plural: 'Cover letters',
    title: 'Cover Letter',
    idKey: 'letter_id',
  },
}

// The first of "Copy of [name]", "Copy 2 of [name]", and so on that no other resume (or cover
// letter) has, ignoring capitals, since names are unique (docs/FRONTEND_CHECKS.md, "Names of
// resumes and cover letters").
export function copyName(name: string, taken: string[]) {
  const names = new Set(taken.map((other) => other.toLowerCase()))
  for (let count = 1; ; count++) {
    const candidate = `${count === 1 ? 'Copy' : `Copy ${count}`} of ${name}`.slice(0, 204)
    if (!names.has(candidate.toLowerCase())) return candidate
  }
}

// A document's name as the app shows it everywhere but its own name field: a base version's ends
// in "Base Resume" (or "Base Cover Letter"), so its name is only what sets it apart ("Mentoring").
// The backend names them the same way in lists of uses (shown_name in backend/app/versions.py).
export const shownName = (kind: DocKind, doc: Pick<Doc, 'name' | 'job_posting'>) =>
  doc.job_posting ? doc.name : `${doc.name} Base ${KINDS[kind].title}`

// "resume" → "Resume", for a heading.
export const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1)

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

// A tree as restoreTree sends it: each section with its items in order, and each item with
// exactly its skills and bullets. Two trees with the same shape show the same thing.
export const treeShape = (sections: TreeSection[]) =>
  sections.map((section) => ({
    section_id: section.section_id,
    entries: section.entries.map((entry) => ({
      kind: entry.kind,
      item_id: entry.item_id,
      skill_ids: entry.skills.map((skill) => skill.item_id),
      bullet_ids: entry.bullets.map((bullet) => bullet.item_id),
    })),
  }))

type Raw = Omit<Doc, 'id'> & { resume_id?: number; letter_id?: number }

const withId = <T extends Doc>(kind: DocKind, raw: Raw) => ({ ...raw, id: raw[KINDS[kind].idKey] }) as T

export function docsApi(kind: DocKind) {
  const path = KINDS[kind].path
  const one = (request: Promise<Raw>) => request.then((raw) => withId<DocDetail>(kind, raw))
  return {
    // Most recently updated first.
    list: () => api.get<Raw[]>(path).then((list) => list.map((raw) => withId<Doc>(kind, raw))),
    get: (id: number) => one(api.get<Raw>(`${path}/${id}`)),
    // A new base version, or with `forPosting`, one for that posting. What's left out is filled
    // in by the backend: the posting's header (or for a base version the most recently used
    // one), for a letter "[organization] Hiring Team" and "Sincerely", and the sections (each
    // with its items) of the latest document of the same kind.
    // With `empty`, it starts with no sections at all ("Build from scratch").
    create: (name: string, forPosting?: ForPosting, options: { empty?: boolean; tone_set_id?: number | null } = {}) =>
      one(api.post<Raw>(path, { name, ...forPosting, ...options })),
    // A posting's version started by Claude: empty, with Claude's suggestion in its draft to review.
    // If Claude fails (AI_UNAVAILABLE), nothing is created.
    // With `startFromId`, Claude starts from that saved one instead of picking one.
    tailor: (name: string, forPosting: ForPosting, toneSetId: number | null, startFromId: number | null = null) =>
      one(
        api.post<Raw>(`${path}/tailored`, {
          name,
          ...forPosting,
          tone_set_id: toneSetId,
          start_from_id: startFromId,
        }),
      ),
    // The first pass over Claude's draft, as its whole tree. Only the draft changes.
    saveDraft: (id: number, sections: DraftSection[]) => one(api.put<Raw>(`${path}/${id}/draft`, { sections })),
    // Saves the reviewed draft: Claude's kept wordings become new library rows used here, and `keep`
    // (keys of Claude's texts the draft doesn't use) are kept in the library for later.
    finishReview: (id: number, keep: number[]) => one(api.post<Raw>(`${path}/${id}/draft/finish`, { keep })),
    // What Claude reads in the user's own file or pasted text, each item matched against the
    // library (shared/api/imports.ts). Saves nothing. A file it can't read, or one with no resume
    // (or letter) in it, is VALIDATION_FAILED, on "file" or "text".
    readExisting: async (source: Source) =>
      api.post<Imported>(
        `${path}/read`,
        'file' in source ? { file: { name: source.file.name, data: await base64(source.file) } } : source,
      ),
    // A new one from the corrected items: a base one, or with `forPosting`, one for that posting.
    // With `tailor` (a posting's only), Claude then tailors it from there, with its suggestion in
    // the draft; if Claude fails, nothing is saved.
    saveImported: (body: ImportBody & { name: string; tone_set_id: number | null }, forPosting?: ForPosting, tailor = false) =>
      one(api.post<Raw>(`${path}/imported${tailor ? '/tailored' : ''}`, { ...body, ...forPosting })),
    // A sent version can only be renamed (VERSION_LOCKED otherwise).
    update: (id: number, fields: DocFields) => one(api.put<Raw>(`${path}/${id}`, fields)),
    // A new version with the original's fields, sections, and selections: a base version, or
    // with `forPosting`, one for that posting, with the posting's header.
    copy: (id: number, name: string, forPosting?: ForPosting) =>
      one(api.post<Raw>(`${path}/${id}/copies`, { name, ...forPosting })),
    // A sent version can't be deleted (VERSION_LOCKED); it can be hidden instead.
    delete: (id: number) => api.delete(`${path}/${id}`),
    setHidden: (id: number, hidden: boolean) =>
      api.put<Raw>(`${path}/${id}/hidden`, { hidden }).then((raw) => withId<Doc>(kind, raw)),

    // Building the header and tree (backend/app/routers/document_tree.py). Each call sends the whole list in
    // its new order and returns the document with its new tree and output. Rows left out are
    // removed with everything under them. A sent version returns VERSION_LOCKED.
    // The header's values, each picked or typed on its own: the document points at the saved header
    // with exactly these values, or a new one. No saved header changes.
    setHeader: (id: number, fields: HeaderFields) => one(api.put<Raw>(`${path}/${id}/header`, fields)),
    // The whole tree as it was before (undo and redo): every section, item, skill, and bullet,
    // exactly as sent. Library items aren't changed, so anything written since stays there.
    restoreTree: (id: number, sections: TreeSection[]) =>
      one(api.put<Raw>(`${path}/${id}/tree`, { sections: treeShape(sections) })),
    // A new section: saved to the library and shown last, empty. Its title must be new (DUPLICATE).
    writeSection: (id: number, title: string) => one(api.post<Raw>(`${path}/${id}/sections/written`, { title })),
    // A letter's new sign-off: saved to the library (or the one with the same text) and used here.
    writeSignOff: (id: number, text: string) => one(api.post<Raw>(`${path}/${id}/sign-off/written`, { text })),
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
    write: (id: number, sectionRow: number, item: NewItem) =>
      one(api.post<Raw>(`${path}/${id}/sections/${sectionRow}/written`, item)),
    // A new bullet: saved to the library, listed under the role or project, and shown last under it.
    writeBullet: (id: number, entryKind: 'experience' | 'project', entryRow: number, content: string) =>
      one(api.post<Raw>(`${path}/${id}/items/${entryKind}/${entryRow}/written`, { content })),
    // A new skill: saved to the library, listed under the category (a project's under "Other" and
    // the project), and shown last under it. Its name must be new (DUPLICATE).
    writeSkill: (id: number, entryKind: 'category' | 'project', entryRow: number, skillName: string) =>
      one(api.post<Raw>(`${path}/${id}/items/${entryKind}/${entryRow}/skills/written`, { skill_name: skillName })),
  }
}
