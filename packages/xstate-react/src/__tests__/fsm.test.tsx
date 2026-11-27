import {act, render, screen} from '@testing-library/react'
import {startTransition, Suspense, use, useLayoutEffect} from 'react'
import {describe, expect, expectTypeOf, it} from 'vitest'
import {createFSM, setup, types} from 'xstate/fsm'

import {useActor} from '../index'
import {deferred} from './helpers'

const toggleMachine = createFSM({
  initial: 'inactive',
  states: {
    inactive: {on: {toggle: {target: 'active'}}},
    active: {on: {toggle: {target: 'inactive'}}},
  },
})

const counterMachine = setup({
  schemas: {
    context: types<{count: number}>(),
    events: {inc: types<{by: number}>()},
  },
}).createFSM({
  initial: 'idle',
  context: {count: 0},
  states: {
    idle: {
      on: {inc: ({context, event}) => ({context: {count: context.count + event.by}})},
    },
  },
})

function Toggle() {
  const [snapshot, send] = useActor(toggleMachine)
  return (
    <button type="button" onClick={() => send({type: 'toggle'})}>
      {snapshot.value}
    </button>
  )
}

describe('xstate/fsm', () => {
  it('runs an FSM and sends to it', async () => {
    render(<Toggle />)
    expect(screen.getByRole('button').textContent).toBe('inactive')

    await act(async () => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('active')
  })

  it('types the snapshot and events, and renders sends as transitions', async () => {
    const gate = deferred()
    let send!: ReturnType<typeof useActor<typeof counterMachine>>[1]
    function Count({count}: {count: number}) {
      if (count > 0) {
        use(gate.promise)
      }
      return <p data-testid="count">{count}</p>
    }
    function Counter() {
      const [snapshot, _send] = useActor(counterMachine)
      expectTypeOf(snapshot.context.count).toEqualTypeOf<number>()
      useLayoutEffect(() => {
        send = _send
      })
      return (
        <Suspense fallback={<p data-testid="fallback" />}>
          <Count count={snapshot.context.count} />
        </Suspense>
      )
    }
    render(<Counter />)

    expectTypeOf(send).toBeCallableWith({type: 'inc', by: 2})
    // @ts-expect-error `by` is required
    expectTypeOf(send).toBeCallableWith({type: 'inc'})
    await act(async () => startTransition(() => send({type: 'inc', by: 2})))
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('count').textContent).toBe('2')
  })
})
