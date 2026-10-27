import { describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './client'

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('api client', () => {
  it('returns the parsed body on success', async () => {
    const fetchMock = stubFetch(json({ status: 'ok' }, 200))
    await expect(api.get('/health')).resolves.toEqual({ status: 'ok' })
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET' }))
  })

  it('sends a JSON body', async () => {
    const fetchMock = stubFetch(json({ id: 6 }, 201))
    await api.post('/sections', { title: 'Volunteer Experience' })
    expect(fetchMock).toHaveBeenCalledWith('/api/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title":"Volunteer Experience"}',
    })
  })

  it('returns undefined for 204 No Content', async () => {
    stubFetch(new Response(null, { status: 204 }))
    await expect(api.delete('/sections/6')).resolves.toBeUndefined()
  })

  it('turns the error shape into an ApiError', async () => {
    stubFetch(
      json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid title.', field: 'title' } }, 422),
    )
    const error = await caught(api.post('/sections', {}))
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.message).toBe('Invalid title.')
    expect(error.field).toBe('title')
    expect(error.status).toBe(422)
  })

  it('treats an error without the shape as INTERNAL_ERROR', async () => {
    stubFetch(new Response('Bad Gateway', { status: 502 }))
    const error = await caught(api.get('/health'))
    expect(error.code).toBe('INTERNAL_ERROR')
    expect(error.status).toBe(502)
  })

  it('reports an unreachable backend as INTERNAL_ERROR', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    const error = await caught(api.get('/health'))
    expect(error.code).toBe('INTERNAL_ERROR')
    expect(error.message).toMatch(/backend is running/)
  })
})
