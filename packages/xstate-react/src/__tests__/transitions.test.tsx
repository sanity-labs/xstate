import {act, render, screen} from '@testing-library/react'
import {
  addTransitionType,
  startTransition,
  Suspense,
  use,
  useLayoutEffect,
  useTransition,
  ViewTransition,
} from 'react'
import {describe, expect, it} from 'vitest'
import {createActor, createMachine, SimulatedClock, types} from 'xstate'

import {useActor} from '../index'
import {counterMachine, deferred, recordViewTransitionTypes} from './helpers'

function Gate({count, gate}: {count: number; gate: Promise<void>}) {
  if (count > 0) {
    use(gate)
  }
  return <p data-testid="count">{count}</p>
}

function setup(gate: Promise<void>) {
  let send!: ReturnType<typeof useActor<typeof counterMachine>>[1]
  let isPending = false
  function App() {
    const [snapshot, _send] = useActor(counterMachine)
    const [pending] = useTransition()
    useLayoutEffect(() => {
      send = _send
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
    isPending: () => isPending,
  }
}

function Reader({count, gate}: {count: number; gate?: Promise<void>}) {
  if (gate && count > 0) {
    use(gate)
  }
  return <span>{count}</span>
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

  it('makes every reader of the snapshot update in the same transition', async () => {
    const gate = deferred()
    let send!: (event: {type: 'inc'}) => void
    function App() {
      const [snapshot, _send] = useActor(counterMachine)
      useLayoutEffect(() => {
        send = _send
      })
      const {count} = snapshot.context
      return (
        <p data-testid="readers">
          <Reader count={count} />
          <Suspense fallback="…">
            <Reader count={count} gate={gate.promise} />
          </Suspense>
        </p>
      )
    }
    render(<App />)

    await act(async () => startTransition(() => send({type: 'inc'})))
    expect(screen.getByTestId('readers').textContent).toBe('00')

    await act(async () => gate.resolve())
    expect(screen.getByTestId('readers').textContent).toBe('11')
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

function renderToast() {
  const gate = deferred()
  const clock = new SimulatedClock()
  let send!: ReturnType<typeof useActor<typeof toastMachine>>[1]
  function Toast() {
    const [snapshot, _send] = useActor(toastMachine, {clock})
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
  it('waits behind the transition, and renders with it', async () => {
    const {gate, clock, send} = renderToast()

    await act(async () => startTransition(() => send({type: 'search', query: 'x'})))
    await act(async () => clock.increment(1000))
    expect(screen.getByTestId('toast').textContent).toBe('visible')
    expect(screen.getByTestId('query').textContent).toBe('')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('toast').textContent).toBe('hidden')
    expect(screen.getByTestId('query').textContent).toBe('x')
  })
})
