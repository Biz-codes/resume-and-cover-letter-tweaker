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
  project_id: number
  skills: { skill_id: number; skill_name: string }[]
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
  // A sent version never changes, and in-progress ones change only with applyToUnsent; otherwise
  // the change is saved as a new version with a new id (FRONTEND_CHECKS.md, "Changing a role or project").
  update: (id: number, fields: ProjectFields, applyToUnsent: boolean) =>
    api.put<Project>(`/projects/${id}`, { ...fields, apply_to_unsent: applyToUnsent }),
  delete: (id: number) => api.delete(`/projects/${id}`),
}
