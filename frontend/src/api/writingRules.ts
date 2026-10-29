// Writing rules: banned terms and patterns (docs/WRITING_RULES.md). See
// backend/app/routers/writing_rules.py.
import { api } from './client'

export type RuleKind = 'term' | 'pattern'

export interface WritingRuleFields {
  kind: RuleKind
  rule_text: string
  // An inactive rule is kept but not applied.
  active: boolean
}

export interface WritingRule extends WritingRuleFields {
  writing_rule_id: number
}

export const writingRulesApi = {
  list: () => api.get<WritingRule[]>('/writing-rules'),
  create: (fields: WritingRuleFields) => api.post<WritingRule>('/writing-rules', fields),
  update: (id: number, fields: WritingRuleFields) => api.put<WritingRule>(`/writing-rules/${id}`, fields),
  delete: (id: number) => api.delete(`/writing-rules/${id}`),
}
