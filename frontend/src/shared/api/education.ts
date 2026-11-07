// Education entries. See backend/app/routers/education.py.
import { api } from './client'
import { refs, type Use } from './usage'

export interface EducationFields {
  degree: string
  institution: string
  details: string | null
  graduation: string | null
}

export interface Education extends EducationFields {
  // Set aside: not offered anywhere new, but kept wherever it's used.
  hidden: boolean
  education_id: number
  // When it was added, which tells versions apart in lists (labels.ts).
  created_at: string
  sections: { id: number; title: string }[]
  used_by: Use[]
}

// Versions of an entry can share a degree and institution, so the graduation tells them apart.
export function educationLabel(entry: Pick<Education, 'degree' | 'institution' | 'graduation'>) {
  const name = `${entry.degree}, ${entry.institution}`
  return entry.graduation ? `${name} (${entry.graduation})` : name
}

export const educationApi = {
  list: () => api.get<Education[]>('/education'),
  // Listed under "Education" unless another section (or none, null) is picked.
  create: (fields: EducationFields, sectionId: number | null) =>
    api.post<Education>('/education', { ...fields, section_id: sectionId }),
  // Saved as a new entry with a new id unless every one in progress is picked in applyTo and nothing sent uses
  // it (FRONTEND_CHECKS.md, "Changing an item").
  update: (id: number, fields: EducationFields, applyTo: Use[]) =>
    api.put<Education>(`/education/${id}`, { ...fields, apply_to: refs(applyTo) }),
  setHidden: (id: number, hidden: boolean) => api.put<Education>(`/education/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/education/${id}`),
}
