// Skill categories and skills. See backend/app/routers/skill_categories.py and skills.py.
import { api } from './client'
import type { Use } from './usage'

export const OTHER_CATEGORY_ID = 1

export interface SkillCategory {
  hidden: boolean
  category_id: number
  category_name: string
  // The built-in "Other" category can't be renamed or deleted.
  built_in: boolean
  skills: { skill_id: number; skill_name: string; hidden: boolean }[]
  sections: { id: number; title: string }[]
  used_by: Use[]
}

export interface Skill {
  hidden: boolean
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
  // Moves its skills and its resume and cover letter selections under "Other" first.
  addVersion: (id: number, categoryName: string) =>
    api.post<SkillCategory>(`/skill-categories/${id}/versions`, { category_name: categoryName }),
  setHidden: (id: number, hidden: boolean) => api.put<SkillCategory>(`/skill-categories/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/skill-categories/${id}`),
}

export const skillsApi = {
  list: () => api.get<Skill[]>('/skills'),
  create: (skillName: string, categoryId: number) =>
    api.post<Skill>('/skills', { skill_name: skillName, category_id: categoryId }),
  // When a sent version uses the skill, the new name is saved as a new skill.
  rename: (id: number, skillName: string) => api.put<Skill>(`/skills/${id}`, { skill_name: skillName }),
  addVersion: (id: number, skillName: string) => api.post<Skill>(`/skills/${id}/versions`, { skill_name: skillName }),
  setHidden: (id: number, hidden: boolean) => api.put<Skill>(`/skills/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/skills/${id}`),
}
