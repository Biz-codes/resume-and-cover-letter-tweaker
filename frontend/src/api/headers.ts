// Headers: the name, headline, and contact details at the top of a resume or cover letter.
// See backend/app/routers/headers.py and "Headers" in docs/FRONTEND_CHECKS.md.
import { api } from './client'

export interface HeaderFields {
  full_name: string
  headline: string | null
  email: string | null
  phone: string | null
  location: string | null
  linkedin_url: string | null
  github_url: string | null
  portfolio_url: string | null
}

export interface HeaderUse {
  kind: 'job_posting' | 'resume' | 'cover_letter'
  id: number
  name: string
  // A sent version (or a posting already applied to) keeps the header as it is.
  locked: boolean
}

export interface Header extends HeaderFields {
  header_id: number
  used_by: HeaderUse[]
}

export const headersApi = {
  list: () => api.get<Header[]>('/headers'),
  // Returns the identical existing header instead of adding a duplicate.
  create: (fields: HeaderFields) => api.post<Header>('/headers', fields),
  // When a sent version uses the header, the change is saved as a new header with a new id.
  update: (headerId: number, fields: HeaderFields) =>
    api.put<Header>(`/headers/${headerId}`, fields),
  delete: (headerId: number) => api.delete(`/headers/${headerId}`),
}
