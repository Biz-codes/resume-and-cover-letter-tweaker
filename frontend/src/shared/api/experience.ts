// Experience (roles). See backend/app/routers/experience.py.
import { api } from './client'
import type { Use } from './usage'

export interface ExperienceFields {
  role_title: string
  organization: string
  location: string | null
  dates: string | null
}

export interface Experience extends ExperienceFields {
  // Set aside: not offered anywhere new, but kept wherever it's used.
  hidden: boolean
  experience_id: number
  // When it was added, which tells versions apart in lists (labels.ts).
  created_at: string
  bullets: { bullet_id: number; content: string }[]
  sections: { id: number; title: string }[]
  used_by: Use[]
}

// Versions of a role can share a title and organization, so the dates tell them apart.
export function experienceLabel(role: Pick<Experience, 'role_title' | 'organization' | 'dates'>) {
  const name = `${role.role_title}, ${role.organization}`
  return role.dates ? `${name} (${role.dates})` : name
}

export const experienceApi = {
  list: () => api.get<Experience[]>('/experience'),
  // Listed under "Experience" unless another section (or none, null) is picked.
  create: (fields: ExperienceFields, sectionId: number | null) =>
    api.post<Experience>('/experience', { ...fields, section_id: sectionId }),
  // Adds another version on purpose, sharing the role's bullets. Nothing switches to it.
  // With nothing changed, returns the original.
  addVersion: (id: number, fields: ExperienceFields) =>
    api.post<Experience>(`/experience/${id}/versions`, fields),
  setBullets: (id: number, bulletIds: number[]) =>
    api.put<Experience>(`/experience/${id}/bullets`, { bullet_ids: bulletIds }),
  // A sent version never changes, and in-progress ones change only when picked in applyTo. Unless
  // every one in progress is picked and nothing sent uses it, the change is saved as a new version
  // with a new id, which the picked ones switch to (FRONTEND_CHECKS.md, "Changing a role or project").
  update: (id: number, fields: ExperienceFields, applyTo: Use[]) =>
    api.put<Experience>(`/experience/${id}`, { ...fields, apply_to: applyTo.map(({ kind, id }) => ({ kind, id })) }),
  setHidden: (id: number, hidden: boolean) => api.put<Experience>(`/experience/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/experience/${id}`),
}
