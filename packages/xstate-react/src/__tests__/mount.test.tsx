import {act, render, screen} from '@testing-library/react'
import {Activity, startTransition, Suspense, use, useLayoutEffect, useState} from 'react'
import {describe, expect, it} from 'vitest'

import {useActor} from '../index'
import {counterMachine, deferred} from './helpers'

type Send = ReturnType<typeof useActor<typeof counterMachine>>[1]

function Count({id, count}: {id: string; count: number}) {
  return <span data-testid={id}>{count}</span>
}

function Gate({count, promise}: {count: number; promise: Promise<void>}) {
  if (count > 0) {
    use(promise)
  }
  return null
}

function setup(gate: Promise<void>) {
  const controls = {} as {
    send: Send
    mount: (mounted: boolean) => void
  }
  function App() {
    const [snapshot, send] = useActor(counterMachine)
    const [mounted, setMounted] = useState(false)
    useLayoutEffect(() => {
      controls.send = send
      controls.mount = setMounted
    }, [send])
    const {count} = snapshot.context
    return (
      <>
        <Count id="early" count={count} />
        <Suspense fallback={null}>
          <Gate count={count} promise={gate} />
        </Suspense>
        {mounted ? <Count id="late" count={count} /> : null}
      </>
    )
  }
  render(<App />)
  return controls
}

describe('a component mounting while a transition is changing the actor', () => {
  it('shows the committed snapshot when an urgent update mounts it, then joins the transition', async () => {
    const gate = deferred()
    const controls = setup(gate.promise)

    await act(async () => startTransition(() => controls.send({type: 'inc'})))
    expect(screen.getByTestId('early').textContent).toBe('0')

    await act(async () => controls.mount(true))
    expect(screen.getByTestId('late').textContent).toBe('0')
    expect(screen.getByTestId('early').textContent).toBe('0')

    await act(async () => gate.resolve())
    expect(screen.getByTestId('early').textContent).toBe('1')
    expect(screen.getByTestId('late').textContent).toBe('1')
  })

  it('does the same while an async action holds the transition open', async () => {
    const gate = deferred()
    gate.resolve()
    const controls = setup(gate.promise)
    const hold = deferred()

    let action!: Promise<void>
    await act(async () =>
      startTransition(() => {
        controls.send({type: 'inc'})
        action = hold.promise
        return action
      }),
    )
    expect(screen.getByTestId('early').textContent).toBe('0')

    await act(async () => controls.mount(true))
    expect(screen.getByTestId('late').textContent).toBe('0')

    await act(async () => {
      hold.resolve()
      await action
    })
    expect(screen.getByTestId('early').textContent).toBe('1')
    expect(screen.getByTestId('late').textContent).toBe('1')
  })

  it('shows the new snapshot when the transition itself mounts it', async () => {
    const gate = deferred()
    gate.resolve()
    const controls = setup(gate.promise)

    await act(async () =>
      startTransition(() => {
        controls.send({type: 'inc'})
        controls.mount(true)
      }),
    )
    expect(screen.getByTestId('early').textContent).toBe('1')
    expect(screen.getByTestId('late').textContent).toBe('1')
  })
})

const replaced = {} as {
  setKept: (kept: string) => void
  send: Send
}

function Kept() {
  const [kept, setKept] = useState('')
  const [snapshot, send] = useActor(counterMachine)
  useLayoutEffect(() => {
    replaced.setKept = setKept
    replaced.send = send
  }, [send])
  return <span data-testid="kept">{`${kept}${snapshot.context.count}`}</span>
}

function ActivityApp({mode}: {mode: 'visible' | 'hidden'}) {
  return (
    <Activity mode={mode}>
      <Kept />
    </Activity>
  )
}

describe('a component whose stopped actor is replaced', () => {
  it('keeps its other state, and reads and sends to the new actor', async () => {
    const {rerender} = render(<ActivityApp mode="visible" />)
    const firstSend = replaced.send
    await act(async () => {
      replaced.setKept('kept')
      firstSend({type: 'inc'})
    })
    expect(screen.getByTestId('kept').textContent).toBe('kept1')

    await act(async () => rerender(<ActivityApp mode="hidden" />))
    await act(async () => rerender(<ActivityApp mode="visible" />))
    expect(replaced.send).not.toBe(firstSend)
    expect(screen.getByTestId('kept').textContent).toBe('kept0')

    await act(async () => replaced.send({type: 'inc'}))
    expect(screen.getByTestId('kept').textContent).toBe('kept1')
  })
})
