// Tone sets and their ordered rules. See backend/app/routers/tone_sets.py.
import { api } from './client'
import type { Use } from './usage'

export interface ToneSet {
  tone_set_id: number
  name: string
  rules: { tone_rule_id: number; rule_text: string }[]
  used_by: Use[]
}

export const toneSetsApi = {
  list: () => api.get<ToneSet[]>('/tone-sets'),
  create: (name: string) => api.post<ToneSet>('/tone-sets', { name }),
  rename: (id: number, name: string) => api.put<ToneSet>(`/tone-sets/${id}`, { name }),
  delete: (id: number) => api.delete(`/tone-sets/${id}`),
  // Each rule call returns the whole set.
  addRule: (id: number, ruleText: string) => api.post<ToneSet>(`/tone-sets/${id}/rules`, { rule_text: ruleText }),
  // Every rule in the set, in the new order.
  orderRules: (id: number, ruleIds: number[]) =>
    api.put<ToneSet>(`/tone-sets/${id}/rules`, { tone_rule_ids: ruleIds }),
  updateRule: (id: number, ruleId: number, ruleText: string) =>
    api.put<ToneSet>(`/tone-sets/${id}/rules/${ruleId}`, { rule_text: ruleText }),
  deleteRule: (id: number, ruleId: number) => api.delete<ToneSet>(`/tone-sets/${id}/rules/${ruleId}`),
}
