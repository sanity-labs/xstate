import {createMachine, types} from 'xstate'

import {writeLatency, type ApiPath, type Latency, type MockRequest} from '@/mocks/latency'

export const networkMachine = createMachine({
  schemas: {
    input: types<{latency: Record<ApiPath, Latency>}>(),
    context: types<{
      latency: Record<ApiPath, Latency>
      requests: Record<ApiPath, MockRequest[]>
    }>(),
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
          requests: {...context.requests, [path]: [...context.requests[path], event.request]},
          // A realistic latency is random, so the latest request's is the one to show.
          latency:
            latency.mode === 'real'
              ? {...context.latency, [path]: {mode: 'real', ms}}
              : context.latency,
        },
      }
    },
    'request.end': ({context, event}) => ({
      context: {
        requests: {
          ...context.requests,
          [event.path]: context.requests[event.path].filter((request) => request.id !== event.id),
        },
      },
    }),
  },
})
