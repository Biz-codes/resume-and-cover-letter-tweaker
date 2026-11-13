// Tone rules: library items any tone can list. See backend/app/routers/tone_rules.py.
import { api } from './client'
import { refs, type Use } from './usage'

// A tone that lists the rule, with the resumes and cover letters that use it.
export interface ToneListing {
  tone_set_id: number
  name: string
  used_by: Use[]
}

export interface ToneRule {
  tone_rule_id: number
  rule_text: string
  hidden: boolean
  tones: ToneListing[]
  // Every resume and cover letter whose tone lists it.
  used_by: Use[]
}

const key = (use: Use) => `${use.kind}:${use.id}`

// The tones an edit to the rule saves as new ones, given the resumes and cover letters picked to
// get it: each used by picked ones and others (or sent ones), whose original then needs a new name
// (backend/app/routers/tone_rules.py).
export function splitTones(rule: ToneRule, picked: Use[]): ToneListing[] {
  const chosen = new Set(picked.filter((use) => !use.locked).map(key))
  return rule.tones.filter(
    (tone) => tone.used_by.some((use) => chosen.has(key(use))) && tone.used_by.some((use) => !chosen.has(key(use))),
  )
}

export const toneRulesApi = {
  list: () => api.get<ToneRule[]>('/tone-rules'),
  // A new rule, or the saved one with the same text.
  create: (ruleText: string) => api.post<ToneRule>('/tone-rules', { rule_text: ruleText }),
  // Saved as a new rule unless every one in progress that uses it is picked and nothing sent does;
  // earlierNames names the original of each tone that's then saved as a new one, by its id.
  update: (id: number, ruleText: string, applyTo: Use[], earlierNames: Record<number, string>) =>
    api.put<ToneRule>(`/tone-rules/${id}`, { rule_text: ruleText, apply_to: refs(applyTo), earlier_names: earlierNames }),
  setHidden: (id: number, hidden: boolean) => api.put<ToneRule>(`/tone-rules/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/tone-rules/${id}`),
}
