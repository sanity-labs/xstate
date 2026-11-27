import {act, render, screen} from '@testing-library/react'
import {
  Activity,
  addTransitionType,
  Component,
  startTransition,
  StrictMode,
  Suspense,
  use,
  useCallback,
  useLayoutEffect,
  ViewTransition,
  type ReactNode,
} from 'react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createAsyncLogic, createCallbackLogic, createMachine, types, type AnyActorRef} from 'xstate'

import {useDurableActor as useActor} from '../prototypes/useDurableActor'
import {counterMachine, deferred, recordViewTransitionTypes} from './helpers'

const viewTransitionTypes = recordViewTransitionTypes()

function Gate({count, gate}: {count: number; gate: Promise<void>}) {
  if (count > 0) {
    use(gate)
  }
  return <p data-testid="count">{count}</p>
}

describe('isPending', () => {
  it('is true from `send` until the transition commits, including while a leaf suspends', async () => {
    const gate = deferred()
    const pendings: boolean[] = []
    let send!: ReturnType<typeof useActor<typeof counterMachine>>[1]
    function App() {
      const [snapshot, _send, isPending] = useActor(counterMachine)
      useLayoutEffect(() => {
        send = _send
        pendings.push(isPending)
      })
      return (
        <Suspense fallback={<p data-testid="fallback" />}>
          <Gate count={snapshot.context.count} gate={gate.promise} />
        </Suspense>
      )
    }
    render(<App />)
    expect(pendings).toEqual([false])

    await act(async () => send({type: 'inc'}))
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.queryByTestId('fallback')).toBeNull()
    expect(pendings.at(-1)).toBe(true)

    await act(async () => gate.resolve())
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(pendings.at(-1)).toBe(false)
  })
})

function setup() {
  const commits: number[] = []
  let send!: ReturnType<typeof useActor<typeof counterMachine>>[1]
  function App() {
    const [snapshot, _send] = useActor(counterMachine)
    useLayoutEffect(() => {
      send = _send
      commits.push(snapshot.context.count)
    })
    return (
      <ViewTransition>
        <p data-testid="count">{snapshot.context.count}</p>
      </ViewTransition>
    )
  }
  render(<App />)
  return {commits, send: (...args: Parameters<typeof send>) => send(...args)}
}

describe('a burst of sends', () => {
  it('applies every event in order, through the action queue', async () => {
    const {send} = setup()
    await act(async () => {
      send({type: 'inc'})
      send({type: 'double'})
      send({type: 'inc'})
    })
    expect(screen.getByTestId('count').textContent).toBe('3')
  })

  it('keeps the transition types of the first send only when the others are queued behind it', async () => {
    const {send} = setup()
    await act(async () => {
      startTransition(() => {
        addTransitionType('first')
        send({type: 'inc'})
      })
      startTransition(() => {
        addTransitionType('second')
        send({type: 'inc'})
      })
    })
    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(viewTransitionTypes).toEqual([['first', 'second']])
  })

  it('carries the types of a send queued behind a pending action', async () => {
    const {send} = setup()
    await act(async () => {
      startTransition(() => {
        addTransitionType('first')
        send({type: 'inc'})
      })
    })
    expect(viewTransitionTypes).toEqual([['first']])
    await act(async () => {
      startTransition(() => {
        addTransitionType('second')
        send({type: 'inc'})
      })
    })
    expect(viewTransitionTypes).toEqual([['first'], ['second']])
  })
})

const fetchMachine = createMachine({
  schemas: {context: types<{result: number | null}>(), events: {go: types<void>()}},
  context: {result: null},
  initial: 'idle',
  states: {
    idle: {on: {go: {target: 'loading'}}},
    loading: {
      invoke: {
        src: createAsyncLogic({
          run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5))
            return 42
          },
        }),
        onDone: ({event}) => ({target: 'done', context: {result: event.output}}),
      },
    },
    done: {},
  },
})

describe('an invoked promise', () => {
  it('reaches the root as an action, and renders its result as a transition', async () => {
    const gate = deferred()
    let send!: ReturnType<typeof useActor<typeof fetchMachine>>[1]
    function Result({result}: {result: number | null}) {
      if (result !== null) {
        use(gate.promise)
      }
      return <p data-testid="result">{String(result)}</p>
    }
    function App() {
      const [snapshot, _send] = useActor(fetchMachine)
      useLayoutEffect(() => {
        send = _send
      })
      return (
        <>
          <p data-testid="state">{snapshot.value}</p>
          <Suspense fallback={<p data-testid="fallback" />}>
            <Result result={snapshot.context.result} />
          </Suspense>
        </>
      )
    }
    render(<App />)
    await act(async () => send({type: 'go'}))
    expect(screen.getByTestId('state').textContent).toBe('loading')

    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(screen.getByTestId('state').textContent).toBe('loading')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('state').textContent).toBe('done')
    expect(screen.getByTestId('result').textContent).toBe('42')
  })
})

const childMachine = createMachine({
  id: 'child',
  initial: 'waiting',
  states: {waiting: {after: {5: {target: 'fired'}}}, fired: {type: 'final'}},
})

const parentMachine = createMachine({
  id: 'parent',
  schemas: {context: types<{childDone: boolean}>()},
  context: {childDone: false},
  initial: 'running',
  states: {
    running: {
      invoke: {src: childMachine, onDone: () => ({target: 'done', context: {childDone: true}})},
      after: {50: {target: 'timedOut'}},
    },
    done: {},
    timedOut: {},
  },
})

function ParentApp() {
  const [snapshot] = useActor(parentMachine)
  return <p data-testid="state">{snapshot.value}</p>
}

describe('timers', () => {
  it('fires a child timer through the adapter and a root timer as an action', async () => {
    render(<ParentApp />)
    expect(screen.getByTestId('state').textContent).toBe('running')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(screen.getByTestId('state').textContent).toBe('done')
  })

  it('fires a root timer when nothing else happens', async () => {
    const toast = createMachine({
      initial: 'visible',
      states: {visible: {after: {10: {target: 'hidden'}}}, hidden: {}},
    })
    function App() {
      const [snapshot] = useActor(toast)
      return <p data-testid="state">{snapshot.value}</p>
    }
    const {unmount} = render(<App />)
    expect(screen.getByTestId('state').textContent).toBe('visible')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)))
    expect(screen.getByTestId('state').textContent).toBe('hidden')
    unmount()
  })
})

describe('StrictMode', () => {
  it('runs entry effects once and keeps the execution through the simulated remount', async () => {
    const entered: AnyActorRef[] = []
    const runs: number[] = []
    const machine = createMachine({
      schemas: {context: types<{count: number}>(), events: {inc: types<void>()}},
      context: {count: 0},
      entry: ({self}, enq) => enq(() => entered.push(self)),
      invoke: {
        src: createAsyncLogic({
          run: async () => {
            runs.push(1)
          },
        }),
      },
      on: {inc: ({context}) => ({context: {count: context.count + 1}})},
    })
    let send!: ReturnType<typeof useActor<typeof machine>>[1]
    function Counter() {
      const [snapshot, _send] = useActor(machine)
      useLayoutEffect(() => {
        send = _send
      })
      return <p data-testid="count">{snapshot.context.count}</p>
    }
    render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    )
    await act(async () => {})
    expect(entered).toHaveLength(1)
    expect(runs).toHaveLength(1)

    await act(async () => send({type: 'inc'}))
    await act(async () => startTransition(() => send({type: 'inc'})))
    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(entered).toHaveLength(1)
    // The root is inert: `self` never learns the state React holds.
    expect(entered[0]!.getSnapshot().context.count).toBe(0)
  })
})

describe('Activity', () => {
  it('stops timers when hidden and starts over when shown again', async () => {
    const entered: unknown[] = []
    const machine = createMachine({
      schemas: {context: types<{count: number}>(), events: {inc: types<void>()}},
      context: {count: 0},
      entry: (_, enq) => enq(() => entered.push(1)),
      on: {inc: ({context}) => ({context: {count: context.count + 1}})},
    })
    let send!: ReturnType<typeof useActor<typeof machine>>[1]
    function Counter() {
      const [snapshot, _send] = useActor(machine)
      useLayoutEffect(() => {
        send = _send
      })
      return <p data-testid="count">{snapshot.context.count}</p>
    }
    const {rerender} = render(
      <Activity mode="visible">
        <Counter />
      </Activity>,
    )
    await act(async () => send({type: 'inc'}))
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(entered).toHaveLength(1)

    await act(async () =>
      rerender(
        <Activity mode="hidden">
          <Counter />
        </Activity>,
      ),
    )
    await act(async () =>
      rerender(
        <Activity mode="visible">
          <Counter />
        </Activity>,
      ),
    )
    expect(entered).toHaveLength(2)
    expect(screen.getByTestId('count').textContent).toBe('0')

    await act(async () => send({type: 'inc'}))
    expect(screen.getByTestId('count').textContent).toBe('1')
  })
})

describe('delivery is asynchronous', () => {
  it('never shows the result of a `send` synchronously, even inside `act`', async () => {
    let send!: ReturnType<typeof useActor<typeof counterMachine>>[1]
    function App() {
      const [snapshot, _send] = useActor(counterMachine)
      useLayoutEffect(() => {
        send = _send
      })
      return <p data-testid="count">{snapshot.context.count}</p>
    }
    render(<App />)
    act(() => send({type: 'inc'}))
    expect(screen.getByTestId('count').textContent).toBe('0')
    await act(async () => {})
    expect(screen.getByTestId('count').textContent).toBe('1')
  })
})

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

describe('an effect that fails', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects the action, which throws into the boundary and disables `dispatch` for good', async () => {
    const machine = createMachine({
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
    let send!: ReturnType<typeof useActor<typeof machine>>[1]
    function Counter() {
      const [snapshot, _send] = useActor(machine)
      useLayoutEffect(() => {
        send = _send
      })
      return <p data-testid="count">{snapshot.context.count}</p>
    }
    render(
      <Boundary>
        <Counter />
      </Boundary>,
    )
    await act(async () => send({type: 'boom'}))
    expect(screen.getByTestId('error').textContent).toBe('effect failed')
  })
})

const reportingMachine = createMachine({
  schemas: {
    context: types<{ready: boolean; pings: number}>(),
    events: {ready: types<void>(), ping: types<void>()},
  },
  context: {ready: false, pings: 0},
  invoke: {
    src: createCallbackLogic(({sendBack}) => {
      sendBack({type: 'ready'})
    }),
  },
  on: {
    ready: ({context}) => ({context: {...context, ready: true}}),
    ping: ({context}) => ({context: {...context, pings: context.pings + 1}}),
  },
})

function Reporter() {
  const [snapshot, send] = useActor(reportingMachine)
  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (node) {
        send({type: 'ping'})
      }
    },
    [send],
  )
  return (
    <p ref={ref} data-testid="state">
      {String(snapshot.context.ready)}:{snapshot.context.pings}
    </p>
  )
}

describe('a send before the hook attached its dispatch', () => {
  it('keeps what the invoked child reports to the root while the execution starts', async () => {
    render(<Reporter />)
    await act(async () => {})
    expect(screen.getByTestId('state').textContent).toBe('true:1')
  })
})

describe('an execution that stopped', () => {
  it('arms no timer after it stopped', async () => {
    const calls: string[] = []
    const clock = {
      setTimeout: (fn: () => void, ms: number) => {
        calls.push(`set ${ms}`)
        return setTimeout(fn, ms)
      },
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    }
    const machine = createMachine({
      schemas: {events: {go: types<void>()}},
      initial: 'idle',
      states: {
        idle: {on: {go: {target: 'waiting'}}},
        waiting: {after: {1000: {target: 'idle'}}},
      },
    })
    let send!: ReturnType<typeof useActor<typeof machine>>[1]
    function Waiter() {
      const [snapshot, _send] = useActor(machine, {clock})
      useLayoutEffect(() => {
        send = _send
      })
      return <p>{snapshot.value}</p>
    }
    const {unmount} = render(<Waiter />)
    await act(async () => {})
    act(() => send({type: 'go'}))
    unmount()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    expect(calls).toEqual([])
  })
})
