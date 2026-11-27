import {render, screen} from '@testing-library/react'
import {
  addTransitionType,
  startTransition,
  Suspense,
  use,
  useLayoutEffect,
  ViewTransition,
} from 'react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createActor} from 'xstate'

import {createActorContext, useActor} from '../../index'
import {counterMachine, deferred} from '../helpers'

interface Observed {
  /** The types of the browser's `ViewTransition`. */
  types: string[]
  /** The types `:active-view-transition-type()` matched while the transition ran. */
  active: string[]
}

/** Records every view transition the browser runs, without replacing or skipping any. */
function observeViewTransitions() {
  const observed: Observed[] = []
  const running: Promise<void>[] = []
  const global = globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = false
    const native = Document.prototype.startViewTransition.bind(document)
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value(options: StartViewTransitionOptions) {
        const transition = native(options)
        const entry: Observed = {types: [...transition.types], active: []}
        observed.push(entry)
        running.push(
          transition.ready.then(() => {
            entry.active = entry.types.filter((type) =>
              document.documentElement.matches(`:active-view-transition-type(${type})`),
            )
          }),
          transition.finished,
        )
        return transition
      },
    })
  })
  afterEach(async () => {
    await Promise.all(running.splice(0))
    observed.length = 0
    delete (document as {startViewTransition?: unknown}).startViewTransition
    global.IS_REACT_ACT_ENVIRONMENT = true
  })
  return {
    observed,
    async finished(count: number): Promise<Observed[]> {
      await vi.waitFor(() => expect(observed).toHaveLength(count))
      await Promise.all(running)
      return observed
    },
  }
}

const Counter = createActorContext(counterMachine)

function Count({id}: {id: string}) {
  const count = Counter.useSelector((snapshot) => snapshot.context.count)
  return (
    <ViewTransition>
      <p data-testid={id}>{count}</p>
    </ViewTransition>
  )
}

function renderCounter() {
  const actor = createActor(counterMachine)
  let send!: (event: {type: 'inc'}) => void
  function Controls() {
    const counterSend = Counter.useSend()
    useLayoutEffect(() => {
      send = counterSend
    })
    return null
  }
  render(
    <Counter.Provider actor={actor}>
      <Count id="a" />
      <section>
        <Count id="b" />
      </section>
      <Controls />
    </Counter.Provider>,
  )
  return {actor, send: (event: {type: 'inc'}) => send(event)}
}

describe('transition types in a real view transition', () => {
  const viewTransitions = observeViewTransitions()

  it('reach the browser when added before `send`', async () => {
    const {send} = renderCounter()

    startTransition(() => {
      addTransitionType('forward')
      send({type: 'inc'})
    })
    const [transition] = await viewTransitions.finished(1)
    expect(transition).toEqual({types: ['forward'], active: ['forward']})
    expect(screen.getByTestId('a').textContent).toBe('1')
    expect(screen.getByTestId('b').textContent).toBe('1')
  })

  it('reach the browser when added after `send`', async () => {
    const {send} = renderCounter()

    startTransition(() => {
      send({type: 'inc'})
      addTransitionType('forward')
    })
    const [transition] = await viewTransitions.finished(1)
    expect(transition).toEqual({types: ['forward'], active: ['forward']})
  })

  it('reach the browser with `actor.send`', async () => {
    const {actor} = renderCounter()

    startTransition(() => {
      addTransitionType('forward')
      actor.send({type: 'inc'})
    })
    const [transition] = await viewTransitions.finished(1)
    expect(transition).toEqual({types: ['forward'], active: ['forward']})
  })

  it('reach the browser when the transition suspends first', async () => {
    const gate = deferred()
    let send!: ReturnType<typeof useActor<typeof counterMachine>>[1]
    function Gated() {
      const [snapshot, counterSend] = useActor(counterMachine)
      useLayoutEffect(() => {
        send = counterSend
      })
      const {count} = snapshot.context
      return (
        <ViewTransition>
          <p data-testid="count">{count}</p>
          {count > 0 ? <Wait gate={gate.promise} /> : null}
        </ViewTransition>
      )
    }
    render(
      <Suspense fallback={<p data-testid="fallback" />}>
        <Gated />
      </Suspense>,
    )

    startTransition(() => {
      addTransitionType('forward')
      send({type: 'inc'})
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(viewTransitions.observed).toEqual([])
    expect(screen.getByTestId('count').textContent).toBe('0')

    gate.resolve()
    const [transition] = await viewTransitions.finished(1)
    expect(transition).toEqual({types: ['forward'], active: ['forward']})
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('reach the browser from `startTransition` after an `await`, with the types added before it', async () => {
    const {send} = renderCounter()

    startTransition(async () => {
      addTransitionType('before-await')
      await Promise.resolve()
      startTransition(() => {
        addTransitionType('after-await')
        send({type: 'inc'})
      })
    })
    const [transition] = await viewTransitions.finished(1)
    expect(transition).toEqual({
      types: ['before-await', 'after-await'],
      active: ['before-await', 'after-await'],
    })
  })

  it('added before an `await` reach the next commit, even from a `send` after it', async () => {
    const {send} = renderCounter()

    startTransition(async () => {
      addTransitionType('before-await')
      await Promise.resolve()
      send({type: 'inc'})
    })
    const [transition] = await viewTransitions.finished(1)
    expect(transition).toEqual({types: ['before-await'], active: ['before-await']})
  })

  it('are empty for a `send` outside `startTransition`', async () => {
    const {send} = renderCounter()

    send({type: 'inc'})
    const [transition] = await viewTransitions.finished(1)
    expect(transition).toEqual({types: [], active: []})
  })
})

function Wait({gate}: {gate: Promise<void>}) {
  use(gate)
  return null
}
