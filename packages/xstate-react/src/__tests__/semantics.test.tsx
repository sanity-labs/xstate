import {act, render, screen} from '@testing-library/react'
import {useEffect} from 'react'
import {describe, expect, it} from 'vitest'
import {createMachine, types} from 'xstate'

import {useActor} from '../index'

const stepMachine = createMachine({
  schemas: {
    input: types<{start: number}>(),
    context: types<{step: number; limit: number}>(),
    events: {'next': types<void>(), 'limit.change': types<{limit: number}>()},
  },
  context: ({input}) => ({step: input.start, limit: 10}),
  on: {
    'next': ({context}) => ({context: {step: Math.min(context.step + 1, context.limit)}}),
    'limit.change': ({event}) => ({context: {limit: event.limit}}),
  },
})

function Stepper({start, limit}: {start: number; limit: number}) {
  const [snapshot, send] = useActor(stepMachine, {input: {start}})
  useEffect(() => {
    send({type: 'limit.change', limit})
  }, [send, limit])
  return (
    <button type="button" onClick={() => send({type: 'next'})}>
      {snapshot.context.step}/{snapshot.context.limit}
    </button>
  )
}

function text() {
  return screen.getByRole('button').textContent
}

describe('useActor', () => {
  it('reads `input` once, takes prop changes as events, and starts over on a new `key`', async () => {
    const {rerender} = render(<Stepper key="a" start={1} limit={2} />)

    expect(text()).toBe('1/2')
    await act(async () => screen.getByRole('button').click())
    await act(async () => screen.getByRole('button').click())
    expect(text()).toBe('2/2')

    rerender(<Stepper key="a" start={5} limit={3} />)
    await act(async () => {})
    expect(text()).toBe('2/3')
    await act(async () => screen.getByRole('button').click())
    expect(text()).toBe('3/3')

    rerender(<Stepper key="b" start={5} limit={6} />)
    await act(async () => {})
    expect(text()).toBe('5/6')
  })
})
