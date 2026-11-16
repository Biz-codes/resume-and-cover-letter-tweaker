// Tones (tone sets) and the rules each one lists, in order. See backend/app/routers/tone_sets.py.
import { api } from './client'
import { refs, type Use } from './usage'

export interface ToneSet {
  // Set aside: not offered anywhere new, but kept wherever it's used.
  hidden: boolean
  tone_set_id: number
  name: string
  // One of the four built-in tones, shared by every account: never changed, hidden, or deleted.
  built_in: boolean
  created_at: string
  // Its rules, in order. A rule can be in many tones (toneRules.ts).
  rules: { tone_rule_id: number; rule_text: string; hidden: boolean; built_in: boolean }[]
  used_by: Use[]
}

// One rule in a tone's list as it's saved: a saved rule by id, or new text (a saved rule with the
// same text, ignoring spacing and capitals, is used instead).
export type RuleChoice = { tone_rule_id: number } | { rule_text: string }

// A tone Claude suggests for a posting's resume or cover letter, which isn't saved until the user
// edits it and saves it (create). Each rule is a saved one (tone_rule_id, with its text) or new text.
export interface ToneSuggestion {
  name: string
  reason: string
  rules: { tone_rule_id: number | null; rule_text: string; reason: string }[]
}

export const toneSetsApi = {
  list: () => api.get<ToneSet[]>('/tone-sets'),
  // The tone a new resume or cover letter starts with: the most recently used one, or Professional.
  default: () => api.get<{ tone_set_id: number }>('/tone-sets/default').then((found) => found.tone_set_id),
  // A new tone with its rules, in order (new text joins the library now).
  create: (name: string, rules: RuleChoice[] = []) => api.post<ToneSet>('/tone-sets', { name, rules }),
  // Claude's tone for this posting's resume or cover letter. Saves nothing.
  suggest: (postingId: number, kind: 'resume' | 'cover_letter') =>
    api.post<ToneSuggestion>('/tone-sets/suggested', { job_posting_id: postingId, kind }),
  // A new tone of the account's own with the same rules, in order, to build on (built-in ones too).
  copy: (id: number, name: string) => api.post<ToneSet>(`/tone-sets/${id}/copies`, { name }),
  // The whole tone: its name and every rule it lists, in order. Saved as a new tone unless every one
  // in progress is picked in applyTo and nothing sent uses it (FRONTEND_CHECKS.md, "Changing an
  // item"); then the new one takes the name and the original is renamed to earlierName.
  update: (id: number, name: string, rules: RuleChoice[], applyTo: Use[], earlierName?: string) =>
    api.put<ToneSet>(`/tone-sets/${id}`, { name, rules, apply_to: refs(applyTo), earlier_name: earlierName ?? null }),
  setHidden: (id: number, hidden: boolean) => api.put<ToneSet>(`/tone-sets/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/tone-sets/${id}`),
}

// Whether saving an edit adds a new tone: one that uses it, sent or not, isn't picked.
export function savesNewTone(usedBy: Use[], picked: Use[]) {
  return usedBy.some((use) => !picked.some((other) => other.kind === use.kind && other.id === use.id))
}
