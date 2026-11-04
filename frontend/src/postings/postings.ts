// Job postings, read from their page or pasted text and checked by the user: the posting, its header, the resumes and cover letters made for
// it, and its tracking. See backend/app/routers/job_postings.py and interviews.py, and "Headers"
// and "Tracking an application" in docs/FRONTEND_CHECKS.md.
import type { Field } from '../shared/components/FieldsForm'
import { api } from '../shared/api/client'
import type { HeaderFields } from '../shared/api/headers'
import type { Use } from '../shared/api/usage'

export interface PostingFields {
  url: string
  organization: string
  role_title: string
  description: string
}

// A posting read by Claude, before the user checks and saves it.
export type PostingDraft = Omit<PostingFields, 'url'>

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
  rejected_on: string | null
  hired_on: string | null
  contacts: string | null
  // In date order.
  interviews: Interview[]
  // The organization's other postings, which an interview can also cover.
  same_organization: PostingRef[]
}

export interface TrackingFields {
  applied_on: string | null
  rejected_on: string | null
  hired_on: string | null
  contacts: string | null
}

export interface InterviewFields {
  interview_on: string | null
  notes: string | null
}

export interface PostingRef {
  job_posting_id: number
  organization: string
  role_title: string
}

export interface Interview {
  interview_id: number
  interview_on: string
  notes: string | null
  // The other postings it covered.
  also_for: PostingRef[]
}

// The fields of the new posting and edit forms.
export const POSTING_FIELDS: Field<PostingFields>[] = [
  // A link, or for a job with no posting online, its primary contact (free text).
  { name: 'url', label: 'Link to the posting or primary contact', required: true },
  { name: 'organization', label: 'Organization', required: true },
  { name: 'role_title', label: 'Role title', required: true },
  { name: 'description', label: 'Job description', required: true, multiline: true },
]

export const TRACKING_FIELDS: Field<TrackingFields>[] = [
  { name: 'applied_on', label: 'Applied on', type: 'date' },
  { name: 'rejected_on', label: 'Turned down on', type: 'date' },
  { name: 'hired_on', label: 'Hired on', type: 'date' },
  { name: 'contacts', label: 'Contacts', multiline: true },
]

export const INTERVIEW_FIELDS: Field<InterviewFields>[] = [
  { name: 'interview_on', label: 'Date', type: 'date', required: true },
  { name: 'notes', label: 'Notes', multiline: true },
]

// "2026-10-05" → "October 5, 2026". Built from its parts, so the time zone can't shift the day.
export function showDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { dateStyle: 'long' })
}

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
  // What Claude finds in the pasted text, or else on the page at the url, for the user to check.
  // Saves nothing. POSTING_FETCH_FAILED when the page can't be read, so it can be pasted in.
  read: (url: string, text: string) => api.post<PostingDraft>('/job-postings/read', { url, text }),
  create: (fields: PostingFields) => api.post<PostingDetail>('/job-postings', fields),
  update: (id: number, fields: PostingFields) => api.put<PostingDetail>(`/job-postings/${id}`, fields),
  // The posting and all its resumes and cover letters point at the saved header with exactly
  // these values, or a new one. An applied posting returns VERSION_LOCKED.
  setHeader: (id: number, fields: HeaderFields) => api.put<PostingDetail>(`/job-postings/${id}/header`, fields),
  // Replaces the dates and contacts, at any time. An applied date locks the posting's versions,
  // and clearing it unlocks them.
  setTracking: (id: number, fields: TrackingFields) =>
    api.put<PostingDetail>(`/job-postings/${id}/tracking`, fields),
  // An interview, and the other postings it covered. It stays linked to this one.
  addInterview: (id: number, fields: InterviewFields, also: number[]) =>
    api.post<PostingDetail>(`/job-postings/${id}/interviews`, { ...fields, also_posting_ids: also }),
  updateInterview: (id: number, interviewId: number, fields: InterviewFields, also: number[]) =>
    api.put<PostingDetail>(`/job-postings/${id}/interviews/${interviewId}`, { ...fields, also_posting_ids: also }),
  // Removes it from every posting it's linked to.
  deleteInterview: (id: number, interviewId: number) => api.delete(`/job-postings/${id}/interviews/${interviewId}`),
  // Deletes its resumes and cover letters, and the interviews only it is linked to.
  delete: (id: number) => api.delete(`/job-postings/${id}`),
}
