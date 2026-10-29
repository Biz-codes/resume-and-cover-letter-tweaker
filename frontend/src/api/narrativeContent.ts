// Narrative content: excerpts of text, from one sentence to a full paragraph, that summaries and
// cover letter paragraphs are built from. See backend/app/routers/narrative_content.py.
import { api } from './client'
import type { Use } from './usage'

export interface NarrativeContent {
  content_id: number
  content: string
  sections: { id: number; title: string }[]
  used_by: Use[]
}

export const narrativeApi = {
  list: () => api.get<NarrativeContent[]>('/narrative-content'),
  // Listed last in each section.
  create: (content: string, sectionIds: number[]) =>
    api.post<NarrativeContent>('/narrative-content', { content, section_ids: sectionIds }),
  // sectionIds is every section that lists the excerpt afterwards: it stays in place in the ones
  // that already list it. When a sent version uses the excerpt and the text changed, the new text
  // is saved as a new excerpt with a new id, and the sections apply to it.
  update: (id: number, content: string, sectionIds: number[]) =>
    api.put<NarrativeContent>(`/narrative-content/${id}`, { content, section_ids: sectionIds }),
  delete: (id: number) => api.delete(`/narrative-content/${id}`),
}
