import {act, render, screen} from '@testing-library/react'
import {
  addTransitionType,
  createContext,
  startTransition,
  Suspense,
  use,
  useLayoutEffect,
  useTransition,
  ViewTransition,
  type ReactNode,
} from 'react'
import {describe, expect, it} from 'vitest'
import {createActor, createMachine, SimulatedClock, types} from 'xstate'

import {useActor, useActorRef, useSelector, useSend, type Updates} from '../index'
import {counterMachine, deferred, recordViewTransitionTypes} from './helpers'

function Gate({count, gate}: {count: number; gate: Promise<void>}) {
  if (count > 0) {
    use(gate)
  }
  return <p data-testid="count">{count}</p>
}

function setup(gate: Promise<void>, updates?: Updates) {
  let send!: ReturnType<typeof useActor<typeof counterMachine>>[1]
  let actor!: ReturnType<typeof useActor<typeof counterMachine>>[2]
  let isPending = false
  function App() {
    const [snapshot, _send, _actor] = useActor(counterMachine, {updates})
    const [pending] = useTransition()
    useLayoutEffect(() => {
      send = _send
      actor = _actor
      isPending = pending
    })
    return (
      <Suspense fallback={<p data-testid="fallback" />}>
        <ViewTransition>
          <Gate count={snapshot.context.count} gate={gate} />
        </ViewTransition>
      </Suspense>
    )
  }
  render(<App />)
  return {
    send: (...args: Parameters<typeof send>) => send(...args),
    get actor() {
      return actor
    },
    isPending: () => isPending,
  }
}

const viewTransitionTypes = recordViewTransitionTypes()

describe('xstate 6.0.0-beta.5', () => {
  it('notifies subscribers before `actor.send()` returns', () => {
    const actor = createActor(counterMachine).start()
    const seen: number[] = []
    actor.subscribe((snapshot) => seen.push(snapshot.context.count))
    actor.send({type: 'inc'})
    expect(seen).toEqual([1])
  })
})

describe('send', () => {
  it('joins the transition it is called in, keeping the content while the next state suspends', async () => {
    const gate = deferred()
    const {send} = setup(gate.promise)

    await act(async () => {
      startTransition(() => {
        addTransitionType('increment')
        send({type: 'inc'})
      })
    })
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(viewTransitionTypes).toContainEqual(['increment'])
  })

  it('keeps the outer transition types when it starts a transition of its own', async () => {
    const gate = deferred()
    gate.resolve()
    const {send} = setup(gate.promise)

    await act(async () => {
      startTransition(() => {
        addTransitionType('outer')
        startTransition(() => send({type: 'inc'}))
      })
    })
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(viewTransitionTypes).toEqual([['outer']])
  })

  it('is a transition of its own when called outside one', async () => {
    const gate = deferred()
    const {send, isPending} = setup(gate.promise)

    await act(async () => send({type: 'inc'}))
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.queryByTestId('fallback')).toBeNull()
    expect(isPending()).toBe(false)

    await act(async () => gate.resolve())
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('needs `startTransition` again after `await` to carry transition types', async () => {
    const gate = deferred()
    const {send, isPending} = setup(gate.promise)
    const loaded = deferred()

    let action!: Promise<void>
    await act(async () => {
      startTransition(() => {
        action = (async () => {
          await loaded.promise
          startTransition(() => {
            addTransitionType('after-await')
            send({type: 'inc'})
          })
        })()
        return action
      })
    })
    await act(async () => {
      loaded.resolve()
      await action
    })
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(isPending()).toBe(false)
    expect(viewTransitionTypes).toContainEqual(['after-await'])
  })

  it('is still a transition after `await` without `startTransition`', async () => {
    const gate = deferred()
    const {send} = setup(gate.promise)

    let action!: Promise<void>
    await act(async () => {
      startTransition(() => {
        action = (async () => {
          await Promise.resolve()
          send({type: 'inc'})
        })()
        return action
      })
      await action
    })
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('makes every reader of the actor update in the same transition', async () => {
    const ActorContext = createContext(createActor(counterMachine))
    const gate = deferred()
    let send!: (event: {type: 'inc'}) => void
    function Reader({gate}: {gate?: Promise<void>}) {
      const actor = use(ActorContext)
      const count = useSelector(actor, (snapshot) => snapshot.context.count)
      if (gate && count > 0) {
        use(gate)
      }
      return <span>{count}</span>
    }
    function Provider({children}: {children: ReactNode}) {
      const actor = useActorRef(counterMachine)
      const providedSend = useSend(actor)
      useLayoutEffect(() => {
        send = providedSend
      })
      return <ActorContext value={actor}>{children}</ActorContext>
    }
    render(
      <Provider>
        <p data-testid="readers">
          <Reader />
          <Suspense fallback="…">
            <Reader gate={gate.promise} />
          </Suspense>
        </p>
      </Provider>,
    )

    await act(async () => startTransition(() => send({type: 'inc'})))
    expect(screen.getByTestId('readers').textContent).toBe('00')

    await act(async () => gate.resolve())
    expect(screen.getByTestId('readers').textContent).toBe('11')
  })
})

describe('updates', () => {
  it("defaults to a transition for snapshot changes that `send` didn't cause", async () => {
    const gate = deferred()
    const app = setup(gate.promise)

    await act(async () => app.actor.send({type: 'inc'}))
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it("renders them with the priority of whatever caused them with `updates: 'sync'`", async () => {
    const gate = deferred()
    const app = setup(gate.promise, 'sync')

    await act(async () => app.actor.send({type: 'inc'}))
    expect(screen.getByTestId('fallback')).toBeTruthy()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it("still makes `send` a transition with `updates: 'sync'`", async () => {
    const gate = deferred()
    const app = setup(gate.promise, 'sync')

    await act(async () => startTransition(() => app.send({type: 'inc'})))
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.queryByTestId('fallback')).toBeNull()
  })
})

const toastMachine = createMachine({
  schemas: {context: types<{query: string}>(), events: {search: types<{query: string}>()}},
  context: {query: ''},
  initial: 'visible',
  states: {
    visible: {after: {1000: {target: 'hidden'}}},
    hidden: {},
  },
  on: {search: ({event}) => ({context: {query: event.query}})},
})

function Results({query, gate}: {query: string; gate: Promise<void>}) {
  if (query) {
    use(gate)
  }
  return <p data-testid="query">{query}</p>
}

function renderToast(updates: Updates) {
  const gate = deferred()
  const clock = new SimulatedClock()
  let send!: ReturnType<typeof useActor<typeof toastMachine>>[1]
  function Toast() {
    const [snapshot, _send] = useActor(toastMachine, {clock, updates})
    useLayoutEffect(() => {
      send = _send
    })
    return (
      <>
        <p data-testid="toast">{snapshot.value}</p>
        <Suspense fallback={<p data-testid="fallback" />}>
          <Results query={snapshot.context.query} gate={gate.promise} />
        </Suspense>
      </>
    )
  }
  render(<Toast />)
  return {gate, clock, send: (...args: Parameters<typeof send>) => send(...args)}
}

describe('a timer firing while a transition is suspended', () => {
  it('waits behind the transition by default, and renders with it', async () => {
    const {gate, clock, send} = renderToast('transition')

    await act(async () => startTransition(() => send({type: 'search', query: 'x'})))
    await act(async () => clock.increment(1000))
    expect(screen.getByTestId('toast').textContent).toBe('visible')
    expect(screen.getByTestId('query').textContent).toBe('')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('toast').textContent).toBe('hidden')
    expect(screen.getByTestId('query').textContent).toBe('x')
  })

  it("renders right away with `updates: 'sync'`, revealing the suspended transition's snapshot", async () => {
    const {gate, clock, send} = renderToast('sync')

    await act(async () => startTransition(() => send({type: 'search', query: 'x'})))
    await act(async () => clock.increment(1000))
    expect(screen.getByTestId('toast').textContent).toBe('hidden')
    expect(screen.getByTestId('fallback')).toBeTruthy()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('query').textContent).toBe('x')
  })
})
