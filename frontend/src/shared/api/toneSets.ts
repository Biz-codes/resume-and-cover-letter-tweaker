// Tone sets and their ordered rules. See backend/app/routers/tone_sets.py.
import { api } from './client'
import { refs, type Use } from './usage'

export interface ToneSet {
  // Set aside: not offered anywhere new, but kept wherever it's used.
  hidden: boolean
  tone_set_id: number
  name: string
  // When it was added, which tells tones with the same name apart in lists (labels.ts).
  created_at: string
  rules: { tone_rule_id: number; rule_text: string }[]
  used_by: Use[]
}

// A rule as it's saved: its id, or null for a new one.
export interface RuleChange {
  tone_rule_id: number | null
  rule_text: string
}

export const toneSetsApi = {
  list: () => api.get<ToneSet[]>('/tone-sets'),
  create: (name: string) => api.post<ToneSet>('/tone-sets', { name }),
  // The whole tone: its name and every rule it keeps, in order. Saved as a new tone (with the same
  // name or the new one) unless every one in progress is picked in applyTo and nothing sent uses
  // it (FRONTEND_CHECKS.md, "Changing an item").
  update: (id: number, name: string, rules: RuleChange[], applyTo: Use[]) =>
    api.put<ToneSet>(`/tone-sets/${id}`, { name, rules, apply_to: refs(applyTo) }),
  setHidden: (id: number, hidden: boolean) => api.put<ToneSet>(`/tone-sets/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/tone-sets/${id}`),
}
