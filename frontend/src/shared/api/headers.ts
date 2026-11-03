// Headers: the name, headline, and contact details at the top of a resume or cover letter.
// See backend/app/routers/headers.py and "Headers" in docs/FRONTEND_CHECKS.md.
import { api } from './client'
import type { Use } from './usage'

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

export type HeaderUse = Use

export interface Header extends HeaderFields {
  // Set aside: not offered anywhere new, but kept wherever it's used.
  hidden: boolean
  header_id: number
  // When it was added, which tells versions apart in lists (labels.ts).
  created_at: string
  used_by: HeaderUse[]
}

// Tells saved headers apart in a picker: the name, headline, and email.
export const headerLabel = (header: HeaderFields) =>
  [header.full_name, header.headline, header.email].filter(Boolean).join(', ')

export const headersApi = {
  list: () => api.get<Header[]>('/headers'),
  // Returns the identical existing header instead of adding a duplicate.
  create: (fields: HeaderFields) => api.post<Header>('/headers', fields),
  // When a sent version uses the header, the change is saved as a new header with a new id.
  update: (headerId: number, fields: HeaderFields) =>
    api.put<Header>(`/headers/${headerId}`, fields),
  addVersion: (headerId: number, fields: HeaderFields) => api.post<Header>(`/headers/${headerId}/versions`, fields),
  setHidden: (headerId: number, hidden: boolean) => api.put<Header>(`/headers/${headerId}/hidden`, { hidden }),
  delete: (headerId: number) => api.delete(`/headers/${headerId}`),
}
