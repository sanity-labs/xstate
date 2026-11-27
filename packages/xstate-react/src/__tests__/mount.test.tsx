import {act, render, screen} from '@testing-library/react'
import {Activity, startTransition, Suspense, use, useLayoutEffect, useState} from 'react'
import {describe, expect, it} from 'vitest'

import {createActorContext, useSelector} from '../index'
import {counterMachine, deferred} from './helpers'

const Counter = createActorContext(counterMachine)

function Count({id}: {id: string}) {
  const count = Counter.useSelector((snapshot) => snapshot.context.count)
  return <span data-testid={id}>{count}</span>
}

function Gate({promise}: {promise: Promise<void>}) {
  const count = Counter.useSelector((snapshot) => snapshot.context.count)
  if (count > 0) {
    use(promise)
  }
  return null
}

function setup(gate: Promise<void>) {
  const controls = {} as {
    send: ReturnType<typeof Counter.useSend>
    mount: (mounted: boolean) => void
  }
  function Controls() {
    const send = Counter.useSend()
    const [mounted, setMounted] = useState(false)
    useLayoutEffect(() => {
      controls.send = send
      controls.mount = setMounted
    }, [send])
    return mounted ? <Count id="late" /> : null
  }
  render(
    <Counter.Provider>
      <Count id="early" />
      <Suspense fallback={null}>
        <Gate promise={gate} />
      </Suspense>
      <Controls />
    </Counter.Provider>,
  )
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
  actor: ReturnType<typeof Counter.useActorRef>
}

function KeptChild() {
  const [kept, setKept] = useState('')
  const count = Counter.useSelector((snapshot) => snapshot.context.count)
  const actor = Counter.useActorRef()
  const selected = useSelector(actor, (snapshot) => snapshot.context.count)
  useLayoutEffect(() => {
    replaced.setKept = setKept
    replaced.actor = actor
  }, [actor])
  return <span data-testid="child">{`${kept}${count}${selected}`}</span>
}

function ActivityApp({mode}: {mode: 'visible' | 'hidden'}) {
  return (
    <Activity mode={mode}>
      <Counter.Provider>
        <KeptChild />
      </Counter.Provider>
    </Activity>
  )
}

describe('a provider whose stopped actor is replaced', () => {
  it('keeps the state of its subtree, and its readers read the new actor', async () => {
    const {rerender} = render(<ActivityApp mode="visible" />)
    const first = replaced.actor
    await act(async () => {
      replaced.setKept('kept')
      first.send({type: 'inc'})
    })
    expect(screen.getByTestId('child').textContent).toBe('kept11')

    await act(async () => rerender(<ActivityApp mode="hidden" />))
    await act(async () => rerender(<ActivityApp mode="visible" />))
    expect(replaced.actor).not.toBe(first)
    expect(screen.getByTestId('child').textContent).toBe('kept00')
  })
})
