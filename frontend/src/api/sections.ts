// Sections. See backend/app/routers/sections.py.
import { api } from './client'
import type { Use } from './usage'

export interface Section {
  id: number
  title: string
  // The five built-in sections can't be renamed or deleted.
  built_in: boolean
  skill_categories: { category_id: number; category_name: string }[]
  used_by: Use[]
}

export const sectionsApi = {
  list: () => api.get<Section[]>('/sections'),
  create: (title: string) => api.post<Section>('/sections', { title }),
  // When a sent version uses the section, the new title is saved as a new section.
  rename: (id: number, title: string) => api.put<Section>(`/sections/${id}`, { title }),
  setCategories: (id: number, categoryIds: number[]) =>
    api.put<Section>(`/sections/${id}/skill-categories`, { category_ids: categoryIds }),
  delete: (id: number) => api.delete(`/sections/${id}`),
}
