// Bullet points. See backend/app/routers/bullet_points.py.
import { api } from './client'
import { refs, type Use } from './usage'

export interface Bullet {
  // Set aside: not offered anywhere new, but kept wherever it's used.
  hidden: boolean
  bullet_id: number
  content: string
  experience: { experience_id: number; role_title: string; organization: string; dates: string | null }[]
  projects: { project_id: number; project_title: string; done_for: string | null }[]
  sections: { id: number; title: string }[]
  used_by: Use[]
}

// Where a new bullet is listed: under a role, a project, or directly in a section.
export type BulletParent = { experience_id: number } | { project_id: number } | { section_id: number }

// The start of a bullet, for naming it in button labels ("Edit "Led the move to…"").
export function shortBullet(content: string, words = 6) {
  const all = content.split(/\s+/)
  return all.length > words ? `${all.slice(0, words).join(' ')}…` : content
}

export const bulletsApi = {
  list: () => api.get<Bullet[]>('/bullet-points'),
  create: (content: string, parent: BulletParent) => api.post<Bullet>('/bullet-points', { content, ...parent }),
  // A sent version never changes, and in-progress ones change only when picked in applyTo. Unless
  // every one in progress is picked and nothing sent uses it, the change is saved as a new bullet
  // with a new id, which the picked ones switch to (FRONTEND_CHECKS.md, "Changing an item").
  update: (id: number, content: string, applyTo: Use[]) =>
    api.put<Bullet>(`/bullet-points/${id}`, { content, apply_to: refs(applyTo) }),
  setHidden: (id: number, hidden: boolean) => api.put<Bullet>(`/bullet-points/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/bullet-points/${id}`),
}
