import { vi } from 'vitest'

// `delayMs` holds the reply back, as a slow request would, so the page renders before it arrives.
export type Reply = { status: number; body?: unknown; delayMs?: number }

// Answers each request from the replies for its method and path ("PUT /api/skills/3"), in order.
// The last reply answers every request after it, since a page and its dialog each read the lists.
export function stubApi(replies: Record<string, Reply[]>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    const queue = replies[key]
    const reply = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (!reply) throw new Error(`unexpected request: ${key}`)
    const response =
      reply.status === 204 ? new Response(null, { status: 204 }) : Response.json(reply.body, { status: reply.status })
    if (!reply.delayMs) return Promise.resolve(response)
    return new Promise<Response>((resolve) => setTimeout(() => resolve(response), reply.delayMs))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// The JSON body of the request sent to `key` ("PUT /api/skills/3"), the nth time (default first).
export function sentBody(fetchMock: ReturnType<typeof stubApi>, key: string, nth = 0) {
  const calls = fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? 'GET'} ${url}` === key)
  return JSON.parse(calls[nth][1]?.body as string)
}

export const errorBody = (code: string, message: string, field: string | null = null) => ({
  error: { code, message, field },
})

// Leaves every request unanswered, so a test can check the loading state without the
// response arriving halfway through the check.
export function stubPendingApi() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
}
