// Tones (tone sets) and the rules each one lists, in order. See backend/app/routers/tone_sets.py.
import { api } from './client'
import { anyLocked, refs, type Use } from './usage'

export interface ToneSet {
  // Set aside: not offered anywhere new, but kept wherever it's used.
  hidden: boolean
  tone_set_id: number
  name: string
  created_at: string
  // Its rules, in order. A rule can be in many tones (toneRules.ts).
  rules: { tone_rule_id: number; rule_text: string; hidden: boolean }[]
  used_by: Use[]
}

// One rule in a tone's list as it's saved: a saved rule by id, or new text (a saved rule with the
// same text, ignoring spacing and capitals, is used instead).
export type RuleChoice = { tone_rule_id: number } | { rule_text: string }

export const toneSetsApi = {
  list: () => api.get<ToneSet[]>('/tone-sets'),
  create: (name: string) => api.post<ToneSet>('/tone-sets', { name }),
  // The whole tone: its name and every rule it lists, in order. Saved as a new tone unless every one
  // in progress is picked in applyTo and nothing sent uses it (FRONTEND_CHECKS.md, "Changing an
  // item"); then the new one takes the name and the original is renamed to earlierName.
  update: (id: number, name: string, rules: RuleChoice[], applyTo: Use[], earlierName?: string) =>
    api.put<ToneSet>(`/tone-sets/${id}`, { name, rules, apply_to: refs(applyTo), earlier_name: earlierName ?? null }),
  setHidden: (id: number, hidden: boolean) => api.put<ToneSet>(`/tone-sets/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/tone-sets/${id}`),
}

// Whether saving an edit adds a new tone: something sent uses it, or one in progress isn't picked.
export function savesNewTone(usedBy: Use[], picked: Use[]) {
  const inProgress = usedBy.filter((use) => !use.locked)
  return anyLocked(usedBy) || inProgress.some((use) => !picked.some((other) => other.kind === use.kind && other.id === use.id))
}
