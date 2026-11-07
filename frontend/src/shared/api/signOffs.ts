// Sign-offs: the closing before the name in a cover letter. See backend/app/routers/sign_offs.py.
import { api } from './client'
import { refs, type Use } from './usage'

export interface SignOff {
  // Set aside: not offered anywhere new, but kept wherever it's used.
  hidden: boolean
  sign_off_id: number
  text: string
  used_by: Use[]
}

export const signOffsApi = {
  list: () => api.get<SignOff[]>('/sign-offs'),
  create: (text: string) => api.post<SignOff>('/sign-offs', { text }),
  // Saved as a new sign-off with a new id unless every one in progress is picked in applyTo and nothing sent uses
  // it (FRONTEND_CHECKS.md, "Changing an item").
  update: (id: number, text: string, applyTo: Use[]) =>
    api.put<SignOff>(`/sign-offs/${id}`, { text, apply_to: refs(applyTo) }),
  setHidden: (id: number, hidden: boolean) => api.put<SignOff>(`/sign-offs/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/sign-offs/${id}`),
}
