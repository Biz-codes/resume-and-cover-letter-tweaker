// Education entries. See backend/app/routers/education.py.
import { api } from './client'
import type { Use } from './usage'

export interface EducationFields {
  degree: string
  institution: string
  details: string | null
  graduation: string | null
}

export interface Education extends EducationFields {
  education_id: number
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
  // When a sent version uses the entry, the change is saved as a new entry with a new id.
  update: (id: number, fields: EducationFields) => api.put<Education>(`/education/${id}`, fields),
  delete: (id: number) => api.delete(`/education/${id}`),
}
