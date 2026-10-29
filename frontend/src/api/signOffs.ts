// Sign-offs: the closing before the name in a cover letter. See backend/app/routers/sign_offs.py.
import { api } from './client'
import type { Use } from './usage'

export interface SignOff {
  sign_off_id: number
  text: string
  used_by: Use[]
}

export const signOffsApi = {
  list: () => api.get<SignOff[]>('/sign-offs'),
  create: (text: string) => api.post<SignOff>('/sign-offs', { text }),
  // When a sent cover letter uses it, the new text is saved as a new sign-off with a new id.
  update: (id: number, text: string) => api.put<SignOff>(`/sign-offs/${id}`, { text }),
  delete: (id: number) => api.delete(`/sign-offs/${id}`),
}
