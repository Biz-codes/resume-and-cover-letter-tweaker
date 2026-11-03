// Sign-offs: the closing before the name in a cover letter. See backend/app/routers/sign_offs.py.
import { api } from './client'
import type { Use } from './usage'

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
  // When a sent cover letter uses it, the new text is saved as a new sign-off with a new id.
  update: (id: number, text: string) => api.put<SignOff>(`/sign-offs/${id}`, { text }),
  addVersion: (id: number, text: string) => api.post<SignOff>(`/sign-offs/${id}/versions`, { text }),
  setHidden: (id: number, hidden: boolean) => api.put<SignOff>(`/sign-offs/${id}/hidden`, { hidden }),
  delete: (id: number) => api.delete(`/sign-offs/${id}`),
}
