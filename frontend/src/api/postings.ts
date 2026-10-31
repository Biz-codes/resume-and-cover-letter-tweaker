// Job postings, entered by hand: the posting, its header, and the resumes and cover letters made
// for it. See backend/app/routers/job_postings.py and "Headers" in docs/FRONTEND_CHECKS.md.
import type { Field } from '../components/FieldsForm'
import { api } from './client'
import type { HeaderFields } from './headers'
import type { Use } from './usage'

export interface PostingFields {
  url: string
  organization: string
  role_title: string
  description: string
}

export interface Posting extends PostingFields {
  job_posting_id: number
  header_id: number | null
  applied_on: string | null
  // Applied to: its resumes and cover letters are a record of what was sent.
  locked: boolean
  // Its resumes, then its cover letters.
  versions: Use[]
  updated_at: string | null
}

export interface PostingDetail extends Posting {
  // Until it has a header: the most recently used header, with the role title as the headline.
  suggested_header: HeaderFields | null
  // Interviews no other posting is linked to, which deleting the posting deletes too.
  lone_interviews: number
}

// The fields of the new posting and edit forms.
export const POSTING_FIELDS: Field<PostingFields>[] = [
  // A link, or for a job with no posting online, its primary contact (free text).
  { name: 'url', label: 'Link to the posting or primary contact', required: true },
  { name: 'organization', label: 'Organization', required: true },
  { name: 'role_title', label: 'Role title', required: true },
  { name: 'description', label: 'Job description (paste it in)', required: true, multiline: true },
]

// Whether a posting's url field is a web address to link to, not a contact.
export const isWebAddress = (url: string) => /^https?:\/\//i.test(url.trim())

// How a posting is named in headings and links.
export const postingName = (posting: Pick<PostingFields, 'organization' | 'role_title'>) =>
  `${posting.role_title} at ${posting.organization}`

export const postingsApi = {
  // Most recently updated first.
  list: () => api.get<Posting[]>('/job-postings'),
  get: (id: number) => api.get<PostingDetail>(`/job-postings/${id}`),
  // A new posting has no header yet; the user picks one next, from the suggestion.
  create: (fields: PostingFields) => api.post<PostingDetail>('/job-postings', fields),
  update: (id: number, fields: PostingFields) => api.put<PostingDetail>(`/job-postings/${id}`, fields),
  // The posting and all its resumes and cover letters point at the saved header with exactly
  // these values, or a new one. An applied posting returns VERSION_LOCKED.
  setHeader: (id: number, fields: HeaderFields) => api.put<PostingDetail>(`/job-postings/${id}/header`, fields),
  // Deletes its resumes and cover letters, and the interviews only it is linked to.
  delete: (id: number) => api.delete(`/job-postings/${id}`),
}
