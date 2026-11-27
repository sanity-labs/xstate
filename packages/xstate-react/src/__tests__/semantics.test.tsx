import {act, render, screen} from '@testing-library/react'
import {Activity, Suspense, use, useEffect} from 'react'
import {describe, expect, it} from 'vitest'
import {createMachine, types, type Actor} from 'xstate'

import {createActorContext, useActor} from '../index'
import {deferred} from './helpers'

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

function Limit({limit, gate}: {limit: number; gate: Promise<void>}) {
  if (limit === 3) {
    use(gate)
  }
  return <p data-testid="limit">{limit}</p>
}

function LimitReader({limit, gate}: {limit: number; gate: Promise<void>}) {
  const [snapshot, send] = useActor(stepMachine, {input: {start: 1}})
  useEffect(() => {
    send({type: 'limit.change', limit})
  }, [send, limit])
  return <Limit limit={snapshot.context.limit} gate={gate} />
}

function LimitApp(props: {limit: number; gate: Promise<void>}) {
  return (
    <Suspense fallback={<p data-testid="fallback" />}>
      <LimitReader {...props} />
    </Suspense>
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

  it('renders a prop change sent from an effect as a transition', async () => {
    const gate = deferred()
    const {rerender} = render(<LimitApp limit={2} gate={gate.promise} />)
    await act(async () => {})
    expect(screen.getByTestId('limit').textContent).toBe('2')

    await act(async () => rerender(<LimitApp limit={3} gate={gate.promise} />))
    expect(screen.getByTestId('limit').textContent).toBe('2')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => gate.resolve())
    expect(screen.getByTestId('limit').textContent).toBe('3')
  })
})

const counterMachine = createMachine({
  schemas: {context: types<{count: number}>(), events: {inc: types<void>()}},
  context: {count: 0},
  on: {inc: ({context}) => ({context: {count: context.count + 1}})},
})

const ProvidedCounter = createActorContext(counterMachine)

function ProvidedCount() {
  const count = ProvidedCounter.useSelector((snapshot) => snapshot.context.count)
  const send = ProvidedCounter.useSend()
  return (
    <button type="button" onClick={() => send({type: 'inc'})}>
      {count}
    </button>
  )
}

function ProvidedApp({mode}: {mode: 'visible' | 'hidden'}) {
  return (
    <ProvidedCounter.Provider>
      <Activity mode={mode}>
        <ProvidedCount />
      </Activity>
    </ProvidedCounter.Provider>
  )
}

describe('Activity', () => {
  it('stops the actor when hidden, and starts a fresh one when shown again', async () => {
    const seen = new Set<Actor<typeof counterMachine>>()
    function Counter() {
      const [snapshot, send, actor] = useActor(counterMachine)
      useEffect(() => {
        seen.add(actor)
      }, [actor])
      return (
        <button type="button" onClick={() => send({type: 'inc'})}>
          {snapshot.context.count}
        </button>
      )
    }
    const {rerender} = render(
      <Activity mode="visible">
        <Counter />
      </Activity>,
    )
    await act(async () => screen.getByRole('button').click())
    expect(text()).toBe('1')

    rerender(
      <Activity mode="hidden">
        <Counter />
      </Activity>,
    )
    await act(async () => {})
    const [first] = seen
    expect(seen.size).toBe(1)
    expect(first!.getSnapshot().status).toBe('stopped')

    rerender(
      <Activity mode="visible">
        <Counter />
      </Activity>,
    )
    await act(async () => {})
    const [, second] = seen
    expect(seen.size).toBe(2)
    expect(second!.getSnapshot().status).toBe('active')
    expect(text()).toBe('0')
  })

  it('keeps an actor provided from outside the boundary running', async () => {
    const {rerender} = render(<ProvidedApp mode="visible" />)
    await act(async () => screen.getByRole('button').click())
    expect(text()).toBe('1')

    rerender(<ProvidedApp mode="hidden" />)
    await act(async () => {})
    rerender(<ProvidedApp mode="visible" />)
    await act(async () => {})
    expect(text()).toBe('1')
  })
})
