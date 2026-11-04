// Projects. See backend/app/routers/projects.py.
import { api } from './client'
import type { Use } from './usage'

export interface ProjectFields {
  project_title: string
  done_for: string | null
  url: string | null
  dates: string | null
}

export interface Project extends ProjectFields {
  // Set aside: not offered anywhere new, but kept wherever it's used.
  hidden: boolean
  project_id: number
  // When it was added, which tells versions apart in lists (labels.ts).
  created_at: string
  skills: { skill_id: number; skill_name: string; hidden: boolean }[]
  bullets: { bullet_id: number; content: string }[]
  sections: { id: number; title: string }[]
  used_by: Use[]
}

// The title, with who or what the project is affiliated with (done_for), if anything.
export function projectLabel(project: Pick<Project, 'project_title' | 'done_for'>) {
  return project.done_for ? `${project.project_title} (${project.done_for})` : project.project_title
}

export const projectsApi = {
  list: () => api.get<Project[]>('/projects'),
  // Listed under "Projects" unless another section (or none, null) is picked.
  create: (fields: ProjectFields, sectionId: number | null) =>
    api.post<Project>('/projects', { ...fields, section_id: sectionId }),
  // Adds another version on purpose, sharing the project's skills and bullets. Nothing switches to
  // it. With nothing changed, returns the original.
  addVersion: (id: number, fields: ProjectFields) => api.post<Project>(`/projects/${id}/versions`, fields),
  setSkills: (id: number, skillIds: number[]) =>
    api.put<Project>(`/projects/${id}/skills`, { skill_ids: skillIds }),
  setBullets: (id: number, bulletIds: number[]) =>
    api.put<Project>(`/projects/${id}/bullets`, { bullet_ids: bulletIds }),
  // A sent version never changes, and in-progress ones change only when picked in applyTo. Unless
  // every one in progress is picked and nothing sent uses it, the change is saved as a new version
  // with a new id, which the picked ones switch to (FRONTEND_CHECKS.md, "Changing a role, project,
  // bullet, or narrative content").
  update: (id: number, fields: ProjectFields, applyTo: Use[]) =>
    api.put<Project>(`/projects/${id}`, { ...fields, apply_to: applyTo.map(({ kind, id }) => ({ kind, id })) }),
  setHidden: (id: number, hidden: boolean) => api.put<Project>(`/projects/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/projects/${id}`),
}
