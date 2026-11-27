import {createMachine, types} from 'xstate'

import {writeLatency, type ApiPath, type Latency, type MockRequest} from '@/mocks/latency'

export const networkMachine = createMachine({
  schemas: {
    input: types<{latency: Record<ApiPath, Latency>}>(),
    context: types<{latency: Record<ApiPath, Latency>}>(),
    events: {
      'latency.set': types<{path: ApiPath; latency: Latency}>(),
      'request.start': types<{request: MockRequest}>(),
    },
  },
  context: ({input}) => ({latency: input.latency}),
  on: {
    'latency.set': ({context, event}, enq) => {
      enq(() => writeLatency(event.path, event.latency))
      return {context: {latency: {...context.latency, [event.path]: event.latency}}}
    },
    'request.start': ({context, event}) => {
      const {path, ms} = event.request
      // A realistic latency is random, so the latest request's is the one to show.
      if (context.latency[path].mode !== 'real') {
        return undefined
      }
      return {context: {latency: {...context.latency, [path]: {mode: 'real', ms}}}}
    },
  },
})
