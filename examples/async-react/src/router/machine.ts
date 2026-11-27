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
      /** The search box's text. It leads `location.q` while a search is loading. */
      draft: string
      /** Increases on every refresh, so the route's data is fetched again. */
      revision: number
    }>(),
    events: {
      'navigate': types<{path: string}>(),
      'tab.change': types<{tab: string}>(),
      'search.change': types<{value: string}>(),
      'search.submit': types<void>(),
      'refresh': types<void>(),
      'history.traverse': types<{location: Location}>(),
    },
  },
  context: ({input}) => ({
    location: input.location,
    draft: input.location.q,
    revision: 0,
  }),
  on: {
    'navigate': ({event}) => ({
      context: {location: {path: event.path, q: '', tab: 'all'}, draft: ''},
    }),
    'tab.change': ({context, event}) => ({
      context: {location: {...context.location, tab: event.tab}},
    }),
    'search.change': ({event}) => ({context: {draft: event.value}}),
    'search.submit': ({context}) => ({
      context: {location: {...context.location, q: context.draft}},
    }),
    'refresh': ({context}) => ({context: {revision: context.revision + 1}}),
    'history.traverse': ({event}) => ({
      context: {location: event.location, draft: event.location.q},
    }),
  },
})
