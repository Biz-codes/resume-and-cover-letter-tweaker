// Skill categories and skills. See backend/app/routers/skill_categories.py and skills.py.
import { api } from './client'
import type { Use } from './usage'

export const OTHER_CATEGORY_ID = 1

export interface SkillCategory {
  category_id: number
  category_name: string
  // The built-in "Other" category can't be renamed or deleted.
  built_in: boolean
  skills: { skill_id: number; skill_name: string }[]
  sections: { id: number; title: string }[]
  used_by: Use[]
}

export interface Skill {
  skill_id: number
  skill_name: string
  categories: { category_id: number; category_name: string }[]
  projects: { project_id: number; project_title: string; done_for: string | null }[]
  used_by: Use[]
}

export const skillCategoriesApi = {
  list: () => api.get<SkillCategory[]>('/skill-categories'),
  // Listed under "Skills" unless another section (or none, null) is picked.
  create: (categoryName: string, sectionId: number | null) =>
    api.post<SkillCategory>('/skill-categories', { category_name: categoryName, section_id: sectionId }),
  // When a sent version uses the category, the new name is saved as a new category.
  rename: (id: number, categoryName: string) =>
    api.put<SkillCategory>(`/skill-categories/${id}`, { category_name: categoryName }),
  // A skill taken out of its only category moves to "Other".
  setSkills: (id: number, skillIds: number[]) =>
    api.put<SkillCategory>(`/skill-categories/${id}/skills`, { skill_ids: skillIds }),
  // Moves its skills and resume selections under "Other" first.
  delete: (id: number) => api.delete(`/skill-categories/${id}`),
}

export const skillsApi = {
  list: () => api.get<Skill[]>('/skills'),
  create: (skillName: string, categoryId: number) =>
    api.post<Skill>('/skills', { skill_name: skillName, category_id: categoryId }),
  // When a sent version uses the skill, the new name is saved as a new skill.
  rename: (id: number, skillName: string) => api.put<Skill>(`/skills/${id}`, { skill_name: skillName }),
  delete: (id: number) => api.delete(`/skills/${id}`),
}
