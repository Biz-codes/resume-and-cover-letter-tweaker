// API client. Every backend call goes through apiRequest, which turns error responses
// into ApiError using the shape and codes in docs/API_ERRORS.md. Branch on `code`,
// never on `message`; show `message` to the user as is.

export type ErrorCode =
  | 'BUILT_IN_PROTECTED'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'DUPLICATE'
  | 'CROSS_ACCOUNT_LINK'
  | 'VERSION_LOCKED'
  | 'POSTING_FETCH_FAILED'
  | 'AI_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export interface ErrorBody {
  error: {
    code: ErrorCode
    message: string
    field: string | null
  }
}

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly field: string | null
  readonly status: number

  constructor(code: ErrorCode, message: string, field: string | null, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.field = field
    this.status = status
  }
}

const UNREACHABLE_MESSAGE = "Couldn't reach the app's server. Check that the backend is running."
const UNEXPECTED_MESSAGE = 'Something went wrong. Nothing was changed.'

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = (value as ErrorBody).error
  return typeof error?.code === 'string' && typeof error.message === 'string'
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export async function apiRequest<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('INTERNAL_ERROR', UNREACHABLE_MESSAGE, null, 0)
  }

  if (response.status === 204) return undefined as T
  const data: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    if (isErrorBody(data)) {
      const { code, message, field } = data.error
      throw new ApiError(code, message, field, response.status)
    }
    throw new ApiError('INTERNAL_ERROR', UNEXPECTED_MESSAGE, null, response.status)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => apiRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => apiRequest<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>('PATCH', path, body),
  delete: <T = void>(path: string) => apiRequest<T>('DELETE', path),
}
