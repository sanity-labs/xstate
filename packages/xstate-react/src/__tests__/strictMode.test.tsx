import {act, render, screen} from '@testing-library/react'
import {startTransition, StrictMode} from 'react'
import {describe, expect, it} from 'vitest'
import {createMachine, types, type Actor} from 'xstate'

import {useActor} from '../index'

describe('StrictMode', () => {
  it('keeps one running actor through the simulated unmount and remount', async () => {
    const entered: unknown[] = []
    const machine = createMachine({
      schemas: {context: types<{count: number}>(), events: {inc: types<void>()}},
      context: {count: 0},
      entry: ({self}, enq) => enq(() => entered.push(self)),
      on: {inc: ({context}) => ({context: {count: context.count + 1}})},
    })
    let app!: ReturnType<typeof useActor<typeof machine>>
    function Counter() {
      app = useActor(machine)
      return <p data-testid="count">{app[0].context.count}</p>
    }
    render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    )
    await act(async () => {})

    expect(entered).toHaveLength(1)
    const [, send] = app
    const actor = entered[0] as Actor<typeof machine>
    expect(actor.getSnapshot().status).toBe('active')

    await act(async () => send({type: 'inc'}))
    await act(async () => startTransition(() => send({type: 'inc'})))
    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(actor.getSnapshot().context.count).toBe(2)
    expect(entered).toHaveLength(1)
  })
})
