import {act, render, screen} from '@testing-library/react'
import {startTransition, StrictMode} from 'react'
import {describe, expect, it} from 'vitest'
import {createMachine, types} from 'xstate'

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
    const actors = new Set<unknown>()
    let app!: ReturnType<typeof useActor<typeof machine>>
    function Counter() {
      app = useActor(machine)
      actors.add(app[2])
      return <p data-testid="count">{app[0].context.count}</p>
    }
    render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    )
    await act(async () => {})

    expect(entered).toHaveLength(1)
    const [, send, actor] = app
    expect(actor.getSnapshot().status).toBe('active')
    expect(entered[0]).toBe(actor)

    await act(async () => send({type: 'inc'}))
    await act(async () => startTransition(() => send({type: 'inc'})))
    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(app[2]).toBe(actor)
    expect(entered).toHaveLength(1)
  })
})
