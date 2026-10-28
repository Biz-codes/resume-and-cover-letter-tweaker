// Sections. See backend/app/routers/sections.py.
import { api } from './client'
import type { Use } from './usage'

// The built-in sections' fixed ids (backend/app/models.py). Never look them up by title.
export const BUILT_IN_SECTION_IDS = { summary: 1, skills: 2, experience: 3, projects: 4, education: 5 }

export interface Section {
  id: number
  title: string
  // The five built-in sections can't be renamed or deleted.
  built_in: boolean
  skill_categories: { category_id: number; category_name: string }[]
  experience: { experience_id: number; role_title: string; organization: string; dates: string | null }[]
  projects: { project_id: number; project_title: string; done_for: string | null }[]
  // Bullets listed directly in the section, not under a role or project.
  bullets: { bullet_id: number; content: string }[]
  used_by: Use[]
}

export const sectionsApi = {
  list: () => api.get<Section[]>('/sections'),
  create: (title: string) => api.post<Section>('/sections', { title }),
  // When a sent version uses the section, the new title is saved as a new section.
  rename: (id: number, title: string) => api.put<Section>(`/sections/${id}`, { title }),
  setCategories: (id: number, categoryIds: number[]) =>
    api.put<Section>(`/sections/${id}/skill-categories`, { category_ids: categoryIds }),
  setExperience: (id: number, experienceIds: number[]) =>
    api.put<Section>(`/sections/${id}/experience`, { experience_ids: experienceIds }),
  setProjects: (id: number, projectIds: number[]) =>
    api.put<Section>(`/sections/${id}/projects`, { project_ids: projectIds }),
  setBullets: (id: number, bulletIds: number[]) =>
    api.put<Section>(`/sections/${id}/bullets`, { bullet_ids: bulletIds }),
  delete: (id: number) => api.delete(`/sections/${id}`),
}
