import {describe, expect, test} from 'vitest'
import {createActor} from 'xstate'

import {routerMachine, toHref} from './machine'

function startRouter(href: string) {
  const url = new URL(href, 'http://localhost')
  return createActor(routerMachine, {
    input: {
      location: {
        path: url.pathname,
        q: url.searchParams.get('q') ?? '',
        tab: url.searchParams.get('tab') ?? 'all',
      },
    },
  }).start()
}

function currentHref(router: ReturnType<typeof startRouter>) {
  return toHref(router.getSnapshot().context.location)
}

describe('toHref', () => {
  test('leaves out default search params', () => {
    expect(toHref({path: '/', q: '', tab: 'all'})).toBe('/')
    expect(toHref({path: '/', q: 'sus', tab: 'done'})).toBe('/?q=sus&tab=done')
  })
})

describe('routerMachine', () => {
  test('searches within the current tab', () => {
    const router = startRouter('/?tab=wip')
    router.send({type: 'search.change', q: 'act'})
    expect(currentHref(router)).toBe('/?q=act&tab=wip')
  })

  test('navigating resets the search and tab', () => {
    const router = startRouter('/login')
    router.send({type: 'tab.change', tab: 'done'})
    router.send({type: 'search.change', q: 'act'})
    router.send({type: 'navigate', path: '/'})
    expect(currentHref(router)).toBe('/')
  })

  test('traversing history restores the location', () => {
    const router = startRouter('/')
    router.send({type: 'search.change', q: 'unsent'})
    router.send({type: 'history.traverse', location: {path: '/', q: 'sus', tab: 'all'}})
    expect(currentHref(router)).toBe('/?q=sus')
  })

  test('refreshing bumps the revision', () => {
    const router = startRouter('/')
    router.send({type: 'refresh'})
    router.send({type: 'refresh'})
    expect(router.getSnapshot().context.revision).toBe(2)
  })
})
