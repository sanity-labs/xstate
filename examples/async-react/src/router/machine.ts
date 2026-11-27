import {createMachine, types} from 'xstate'

export interface Location {
  path: string
  q: string
  tab: string
}

export function toHref({path, q, tab}: Location): string {
  const params = new URLSearchParams()
  if (q !== '') {
    params.set('q', q)
  }
  if (tab !== 'all') {
    params.set('tab', tab)
  }
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

export const routerMachine = createMachine({
  schemas: {
    input: types<{location: Location}>(),
    context: types<{
      location: Location
      /** Increases on every refresh, so the route's data is fetched again. */
      revision: number
    }>(),
    events: {
      'navigate': types<{path: string}>(),
      'tab.change': types<{tab: string}>(),
      'search.change': types<{q: string}>(),
      'refresh': types<void>(),
      'history.traverse': types<{location: Location}>(),
    },
  },
  context: ({input}) => ({
    location: input.location,
    revision: 0,
  }),
  on: {
    'navigate': ({event}) => ({
      context: {location: {path: event.path, q: '', tab: 'all'}},
    }),
    'tab.change': ({context, event}) => ({
      context: {location: {...context.location, tab: event.tab}},
    }),
    'search.change': ({context, event}) => ({
      context: {location: {...context.location, q: event.q}},
    }),
    'refresh': ({context}) => ({context: {revision: context.revision + 1}}),
    'history.traverse': ({event}) => ({
      context: {location: event.location},
    }),
  },
})
