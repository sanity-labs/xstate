import {delay, type HttpResponseResolver, type PathParams} from 'msw'

export const API_PATHS = ['/api/lessons', '/api/lesson/:id/toggle'] as const

export type ApiPath = (typeof API_PATHS)[number]

/** A fixed delay, or `real`: a random 100–400ms per request, MSW's realistic browser range. */
export interface Latency {
  mode: 'fixed' | 'real'
  ms: number
}

export interface MockRequest {
  id: string
  path: ApiPath
  label: string
  ms: number
}

export type MockActivity =
  | {type: 'request.start'; request: MockRequest}
  | {type: 'request.end'; path: ApiPath; id: string}

function parseLatency(raw: string | null): Latency {
  try {
    const value: unknown = raw == null ? null : JSON.parse(raw)
    if (
      typeof value === 'object' &&
      value !== null &&
      'mode' in value &&
      (value.mode === 'fixed' || value.mode === 'real') &&
      'ms' in value &&
      typeof value.ms === 'number' &&
      Number.isFinite(value.ms)
    ) {
      return {mode: value.mode, ms: Math.max(0, value.ms)}
    }
  } catch {
    // Unreadable settings fall back to no delay.
  }
  return {mode: 'fixed', ms: 0}
}

/** The latency settings the mock server applies, persisted across reloads. */
export function readLatencies(): Record<ApiPath, Latency> {
  return {
    '/api/lessons': parseLatency(localStorage.getItem('/api/lessons')),
    '/api/lesson/:id/toggle': parseLatency(localStorage.getItem('/api/lesson/:id/toggle')),
  }
}

export function writeLatency(path: ApiPath, latency: Latency): void {
  localStorage.setItem(path, JSON.stringify(latency))
}

const listeners = new Set<(activity: MockActivity) => void>()

export function subscribeToMockActivity(listener: (activity: MockActivity) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function report(activity: MockActivity): void {
  for (const listener of listeners) {
    listener(activity)
  }
}

/** Delays `resolver` by the latency configured for `path`, and reports the request while it runs. */
export function withLatency<Params extends PathParams<keyof Params>>(
  path: ApiPath,
  resolver: HttpResponseResolver<Params>,
): HttpResponseResolver<Params> {
  return async (info) => {
    const latency = readLatencies()[path]
    const ms = latency.mode === 'real' ? Math.floor(100 + Math.random() * 300) : latency.ms
    const {request, requestId: id} = info
    report({
      type: 'request.start',
      request: {id, path, label: `${request.method} ${new URL(request.url).pathname}`, ms},
    })
    try {
      await delay(ms)
      return await resolver(info)
    } finally {
      report({type: 'request.end', path, id})
    }
  }
}
