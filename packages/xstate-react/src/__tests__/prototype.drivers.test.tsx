import {act, render, screen} from '@testing-library/react'
import {Component, StrictMode, useLayoutEffect, type ReactNode} from 'react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  createActor,
  createAsyncLogic,
  createCallbackLogic,
  createMachine,
  types,
  type ActorOptions,
  type AnyActorLogic,
  type EventFromLogic,
  type SnapshotFrom,
} from 'xstate'

import {useActorActionState} from '../prototypes/useActorActionState'
import {useDurableActor} from '../prototypes/useDurableActor'
import {useTransitionActor} from '../prototypes/useTransitionActor'
import {deferred} from './helpers'

/**
 * PALS-175: the same questions asked of each driver behind `useActionState`.
 *
 * - `actor`: a live actor created with `createActor`, bridged by `useActorActionState` (shapes a
 *   and b).
 * - `durable`: `xstate/durable` (shape c).
 * - `transition`: the pure `initialTransition`/`transition`/`executeEffects` API.
 */

type Driver = <TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: ActorOptions<TLogic>,
) => [SnapshotFrom<TLogic>, (event: EventFromLogic<TLogic>) => void, boolean]

function useLiveActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: ActorOptions<TLogic>,
): [SnapshotFrom<TLogic>, (event: EventFromLogic<TLogic>) => void, boolean] {
  const [snapshot, send, isPending] = useActorActionState(useStartedActor(logic, options))
  return [snapshot, send, isPending]
}

const actors = new Map<object, ReturnType<typeof createActor>>()
function useStartedActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: ActorOptions<TLogic>,
): ReturnType<typeof createActor<TLogic>> {
  // One actor per logic per test, started on first use and stopped by the test's cleanup.
  let actor = actors.get(logic) as ReturnType<typeof createActor<TLogic>> | undefined
  if (!actor) {
    actor = createActor(logic, options as never)
    actor.start()
    actors.set(logic, actor)
    created.push(actor)
  }
  return actor
}
const created: {stop(): void}[] = []
afterEach(() => {
  for (const actor of created.splice(0)) {
    actor.stop()
  }
  actors.clear()
})

const drivers: [string, Driver][] = [
  ['actor', useLiveActor],
  ['durable', useDurableActor],
  ['transition', useTransitionActor],
]

const log: string[] = []
beforeEach(() => {
  log.length = 0
})

const fetcher = createAsyncLogic({
  run: async ({input}: {input: number}) => {
    log.push(`fetch ${input}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
    return input * 2
  },
})

const reporter = createCallbackLogic(({sendBack}) => {
  log.push('reporter started')
  sendBack({type: 'report', n: 1})
})

const machine = createMachine({
  schemas: {
    context: types<{count: number; reports: number; fetched: number | null}>(),
    events: {
      inc: types<void>(),
      fetch: types<void>(),
      wait: types<void>(),
      report: types<{n: number}>(),
    },
  },
  context: {count: 0, reports: 0, fetched: null},
  initial: 'idle',
  states: {
    idle: {
      invoke: {src: reporter},
      on: {
        inc: ({context}, enq) => {
          enq(() => log.push(`effect inc -> ${context.count + 1}`))
          return {context: {...context, count: context.count + 1}}
        },
        report: ({context, event}) => ({context: {...context, reports: context.reports + event.n}}),
        fetch: {target: 'fetching'},
        wait: {target: 'waiting'},
      },
    },
    fetching: {
      invoke: {
        src: fetcher,
        input: 21,
        onDone: ({context, event}) => ({
          target: 'idle',
          context: {...context, fetched: event.output},
        }),
      },
    },
    waiting: {
      after: {20: {target: 'idle'}},
    },
  },
})

function renderWith(useDriver: Driver, logic: typeof machine = machine) {
  let send!: (event: EventFromLogic<typeof logic>) => void
  const commits: string[] = []
  const pendings: boolean[] = []
  function App() {
    const [snapshot, _send, isPending] = useDriver(logic)
    useLayoutEffect(() => {
      send = _send
      commits.push(`${snapshot.value}:${snapshot.context.count}`)
      pendings.push(isPending)
    })
    return (
      <p data-testid="state">
        {snapshot.value} {snapshot.context.count} r{snapshot.context.reports} f
        {String(snapshot.context.fetched)}
      </p>
    )
  }
  const result = render(<App />)
  return {
    ...result,
    commits,
    pendings,
    send: (event: EventFromLogic<typeof logic>) => send(event),
    text: () => screen.getByTestId('state').textContent,
  }
}

describe.each(drivers)('%s driver', (name, useDriver) => {
  it('queues a burst of sends and applies them in order, one commit for the batch', async () => {
    const {send, text, commits} = renderWith(useDriver)
    await act(async () => {})
    const before = commits.length
    await act(async () => {
      send({type: 'inc'})
      send({type: 'inc'})
      send({type: 'inc'})
    })
    expect(text()).toBe('idle 3 r1 fnull')
    expect(log.filter((entry) => entry.startsWith('effect inc'))).toEqual([
      'effect inc -> 1',
      'effect inc -> 2',
      'effect inc -> 3',
    ])
    // The actions settle one after the other; React commits the batch at most twice: the pending
    // flip and the result.
    expect(commits.length - before).toBeLessThanOrEqual(2)
  })

  it('runs a delayed transition and renders it as a transition', async () => {
    const {send, text} = renderWith(useDriver)
    await act(async () => {})
    await act(async () => send({type: 'wait'}))
    expect(text()).toBe('waiting 0 r1 fnull')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 40)))
    // Re-entering `idle` invokes the reporter again.
    expect(text()).toBe('idle 0 r2 fnull')
  })

  it('delivers an invoked child result and what a child reports back', async () => {
    const {send, text} = renderWith(useDriver)
    await act(async () => {})
    expect(text()).toBe('idle 0 r1 fnull')
    await act(async () => send({type: 'fetch'}))
    expect(text()).toBe('fetching 0 r1 fnull')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(text()).toBe('idle 0 r2 f42')
    expect(log).toContain('fetch 21')
  })

  it(
    name === 'actor'
      ? 'runs the effects of a send synchronously, inside `send`: React runs the first queued action at once'
      : 'runs the effects of a send inside the action, after `send` returned and before the snapshot commits',
    async () => {
      const {send, commits} = renderWith(useDriver)
      await act(async () => {})
      const order: string[] = []
      const unpatch = patchLog((entry) => order.push(entry))
      await act(async () => {
        send({type: 'inc'})
        order.push('after send returned')
      })
      unpatch()
      order.push(`committed ${commits.at(-1)}`)
      expect(order.indexOf('effect inc -> 1')).toBeLessThan(order.indexOf('committed idle:1'))
      if (name === 'actor') {
        expect(order.indexOf('effect inc -> 1')).toBeLessThan(order.indexOf('after send returned'))
      } else {
        expect(order.indexOf('after send returned')).toBeLessThan(order.indexOf('effect inc -> 1'))
      }
    },
  )

  it(
    name === 'actor'
      ? 'updates the snapshot in the same transition as `send`: a sync action is a plain transition update'
      : 'is never synchronous: the snapshot after `send` updates on the next microtask at the earliest',
    async () => {
      const {send, text} = renderWith(useDriver)
      await act(async () => {})
      act(() => send({type: 'inc'}))
      expect(text()).toBe(name === 'actor' ? 'idle 1 r1 fnull' : 'idle 0 r1 fnull')
      await act(async () => {})
      expect(text()).toBe('idle 1 r1 fnull')
    },
  )

  it('drops the result of an action whose component unmounted while it ran, but runs its effects', async () => {
    const gate = deferred()
    const slow = createMachine({
      schemas: {context: types<{count: number}>(), events: {inc: types<void>()}},
      context: {count: 0},
      on: {
        inc: ({context}, enq) => {
          enq(() => {
            log.push('slow effect started')
            return gate.promise.then(() => log.push('slow effect finished'))
          })
          return {context: {count: context.count + 1}}
        },
      },
    })
    let send!: (event: {type: 'inc'}) => void
    const commits: number[] = []
    function App() {
      const [snapshot, _send] = useDriver(slow)
      useLayoutEffect(() => {
        send = _send
        commits.push(snapshot.context.count)
      })
      return null
    }
    const {unmount} = render(<App />)
    await act(async () => {})
    act(() => send({type: 'inc'}))
    await act(async () => {})
    unmount()
    await act(async () => gate.resolve())
    await act(async () => {})
    expect(log).toEqual(['slow effect started', 'slow effect finished'])
    // The live actor applied the transition synchronously and the action returned it; with
    // the other two the action settled after unmount and React dropped it.
    expect(commits.at(-1)).toBe(name === 'actor' ? 1 : 0)
  })

  it(
    name === 'actor'
      ? 'keeps `send` alive after a machine error: the error is a snapshot, not a rejected action'
      : 'kills `send` after a throwing effect: the rejected action empties the queue',
    async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const boom = createMachine({
        schemas: {
          context: types<{count: number}>(),
          events: {inc: types<void>(), boom: types<void>()},
        },
        context: {count: 0},
        on: {
          inc: ({context}) => ({context: {count: context.count + 1}}),
          boom: (_, enq) => {
            enq(() => {
              throw new Error('effect failed')
            })
          },
        },
      })
      let send!: (event: {type: 'inc'} | {type: 'boom'}) => void
      function App() {
        const [snapshot, _send] = useDriver(boom)
        useLayoutEffect(() => {
          send = _send
        })
        return <p data-testid="count">{snapshot.context.count}</p>
      }
      render(
        <Boundary>
          <App />
        </Boundary>,
      )
      await act(async () => {})
      await act(async () => send({type: 'boom'}))
      expect(screen.getByTestId('error').textContent).toBe('effect failed')
      vi.restoreAllMocks()
    },
  )

  it.skipIf(name === 'actor')(
    'rethrows an initial effect that fails on mount into the boundary, with no unhandled rejection',
    async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const failing = createMachine({
        schemas: {context: types<{count: number}>(), events: {inc: types<void>()}},
        context: {count: 0},
        entry: (_, enq) => {
          enq(() => {
            throw new Error('entry failed')
          })
        },
      })
      function App() {
        const [snapshot] = useDriver(failing)
        return <p data-testid="count">{snapshot.context.count}</p>
      }
      render(
        <Boundary>
          <App />
        </Boundary>,
      )
      await act(async () => {})
      await act(async () => {})
      expect(screen.getByTestId('error').textContent).toBe('entry failed')
      vi.restoreAllMocks()
    },
  )

  it('under StrictMode starts the invoked child once and renders the same result', async () => {
    let send!: (event: EventFromLogic<typeof machine>) => void
    function App() {
      const [snapshot, _send] = useDriver(machine)
      useLayoutEffect(() => {
        send = _send
      })
      return (
        <p data-testid="state">
          {snapshot.value} r{snapshot.context.reports}
        </p>
      )
    }
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await act(async () => {})
    expect(log.filter((entry) => entry === 'reporter started')).toHaveLength(1)
    expect(screen.getByTestId('state').textContent).toBe('idle r1')
    await act(async () => send({type: 'inc'}))
    expect(screen.getByTestId('state').textContent).toBe('idle r1')
  })
})

/** Routes `log.push` through `fn` for the duration. */
function patchLog(fn: (entry: string) => void): () => void {
  const original = log.push.bind(log)
  Object.defineProperty(log, 'push', {
    configurable: true,
    value: (...entries: string[]) => {
      for (const entry of entries) {
        fn(entry)
      }
      return original(...entries)
    },
  })
  return () => {
    Reflect.deleteProperty(log, 'push')
  }
}

class Boundary extends Component<{children: ReactNode}, {error: Error | null}> {
  override state = {error: null as Error | null}
  static getDerivedStateFromError(error: Error) {
    return {error}
  }
  override render() {
    return this.state.error ? (
      <p data-testid="error">{this.state.error.message}</p>
    ) : (
      this.props.children
    )
  }
}
