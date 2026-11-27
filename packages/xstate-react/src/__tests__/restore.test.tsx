import {act, render, screen} from '@testing-library/react'
import {
  Activity,
  startTransition,
  StrictMode,
  Suspense,
  use,
  useLayoutEffect,
  useState,
} from 'react'
import {describe, expect, it} from 'vitest'
import {createActor, createMachine, types, type Actor, type Snapshot} from 'xstate'
import {restoreActor} from 'xstate/persist'

import {useActor} from '../index'
import {deferred} from './helpers'

const counterMachine = createMachine({
  schemas: {context: types<{count: number}>(), events: {inc: types<void>()}},
  context: {count: 0},
  on: {inc: ({context}) => ({context: {count: context.count + 1}})},
})

function persistedAt(count: number): Snapshot<unknown> {
  const actor = createActor(counterMachine).start()
  for (let i = 0; i < count; i++) {
    actor.send({type: 'inc'})
  }
  const persisted = JSON.parse(JSON.stringify(actor.getPersistedSnapshot()))
  actor.stop()
  return persisted
}

describe('an already-created actor', () => {
  it('renders a restored snapshot, and keeps the actor through StrictMode', async () => {
    let restored!: Actor<typeof counterMachine>
    let send!: Actor<typeof counterMachine>['send']
    function Counter({persisted}: {persisted: Snapshot<unknown>}) {
      const [actor] = useState(() => restoreActor(counterMachine, persisted))
      const [snapshot, _send] = useActor(actor)
      useLayoutEffect(() => {
        restored = actor
        send = _send
      })
      return <p data-testid="count">{snapshot.context.count}</p>
    }
    render(
      <StrictMode>
        <Counter persisted={persistedAt(3)} />
      </StrictMode>,
    )
    await act(async () => {})

    expect(screen.getByTestId('count').textContent).toBe('3')
    expect(restored.getSnapshot().status).toBe('active')

    await act(async () => send({type: 'inc'}))
    expect(screen.getByTestId('count').textContent).toBe('4')
    expect(restored.getSnapshot().context.count).toBe(4)
  })

  it('renders its snapshot changes as transitions', async () => {
    const gate = deferred()
    const actor = createActor(counterMachine)
    function Count({count}: {count: number}) {
      if (count > 0) {
        use(gate.promise)
      }
      return <p data-testid="count">{count}</p>
    }
    function Counter() {
      const [snapshot] = useActor(actor)
      return (
        <Suspense fallback={<p data-testid="fallback" />}>
          <Count count={snapshot.context.count} />
        </Suspense>
      )
    }
    render(<Counter />)
    await act(async () => {})

    await act(async () => startTransition(() => actor.send({type: 'inc'})))
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('starts it on mount and stops it on unmount', async () => {
    const actor = createActor(counterMachine)
    function Counter() {
      const [snapshot] = useActor(actor)
      return <p data-testid="count">{snapshot.context.count}</p>
    }
    const {unmount} = render(<Counter />)
    await act(async () => {})
    expect(actor.getSnapshot().status).toBe('active')

    unmount()
    await act(async () => {})
    expect(actor.getSnapshot().status).toBe('stopped')
  })

  it('replaces a stopped restored actor with one restored from the same snapshot', async () => {
    let send!: Actor<typeof counterMachine>['send']
    const persisted = persistedAt(3)
    function Counter() {
      const [actor] = useState(() => restoreActor(counterMachine, persisted))
      const [snapshot, _send] = useActor(actor)
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
    await act(async () => {})
    await act(async () => send({type: 'inc'}))
    expect(screen.getByTestId('count').textContent).toBe('4')

    rerender(
      <Activity mode="hidden">
        <Counter />
      </Activity>,
    )
    await act(async () => {})
    rerender(
      <Activity mode="visible">
        <Counter />
      </Activity>,
    )
    await act(async () => {})
    expect(screen.getByTestId('count').textContent).toBe('3')
  })
})
