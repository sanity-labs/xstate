import {createMachine, types} from 'xstate'

import {writeLatency, type ApiPath, type Latency, type MockRequest} from '@/mocks/latency'

export type Requests = Record<ApiPath, readonly MockRequest[]>

export function addRequest(requests: Requests, request: MockRequest): Requests {
  const current = requests[request.path]
  if (current.some(({id}) => id === request.id)) {
    return requests
  }
  return {...requests, [request.path]: [...current, request]}
}

export function removeRequest(requests: Requests, path: ApiPath, id: string): Requests {
  return {...requests, [path]: requests[path].filter((request) => request.id !== id)}
}

export const networkMachine = createMachine({
  schemas: {
    input: types<{latency: Record<ApiPath, Latency>}>(),
    context: types<{latency: Record<ApiPath, Latency>; requests: Requests}>(),
    events: {
      'latency.set': types<{path: ApiPath; latency: Latency}>(),
      'request.start': types<{request: MockRequest}>(),
      'request.end': types<{path: ApiPath; id: string}>(),
    },
  },
  context: ({input}) => ({
    latency: input.latency,
    requests: {'/api/lessons': [], '/api/lesson/:id/toggle': []},
  }),
  on: {
    'latency.set': ({context, event}, enq) => {
      enq(() => writeLatency(event.path, event.latency))
      return {context: {latency: {...context.latency, [event.path]: event.latency}}}
    },
    'request.start': ({context, event}) => {
      const {path, ms} = event.request
      const latency = context.latency[path]
      return {
        context: {
          requests: addRequest(context.requests, event.request),
          // A realistic latency is random, so the latest request's is the one to show.
          latency:
            latency.mode === 'real'
              ? {...context.latency, [path]: {mode: 'real', ms}}
              : context.latency,
        },
      }
    },
    'request.end': ({context, event}) => ({
      context: {requests: removeRequest(context.requests, event.path, event.id)},
    }),
  },
})
