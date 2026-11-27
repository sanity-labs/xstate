import {act, render, screen} from '@testing-library/react'
import {Component, type ReactNode} from 'react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createMachine} from 'xstate'

import {createActorContext, useActor, useActorRef, useSelector} from '../index'

const failing = createMachine({
  initial: 'idle',
  states: {
    idle: {
      on: {
        fail: () => {
          throw new Error('failed')
        },
      },
    },
  },
})

const Failing = createActorContext(failing)

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

function Value() {
  const value = Failing.useSelector((snapshot) => snapshot.value)
  return <p data-testid="value">{value}</p>
}

function Actor() {
  const [snapshot, send] = useActor(failing)
  return <button onClick={() => send({type: 'fail'})}>{snapshot.value}</button>
}

function Selected() {
  const actor = useActorRef(failing)
  const value = useSelector(actor, (snapshot) => snapshot.value)
  return <button onClick={() => actor.send({type: 'fail'})}>{value}</button>
}

function Fail() {
  const send = Failing.useSend()
  return <button onClick={() => send({type: 'fail'})}>fail</button>
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('an actor that errors', () => {
  it('throws to the error boundary around the provider readers, not around the provider', async () => {
    render(
      <Failing.Provider>
        <Boundary>
          <Value />
        </Boundary>
        <Fail />
      </Failing.Provider>,
    )
    expect(screen.getByTestId('value').textContent).toBe('idle')

    await act(async () => screen.getByText('fail').click())
    expect(screen.getByTestId('error').textContent).toBe('failed')
    expect(screen.getByText('fail')).toBeTruthy()
  })

  it('throws from `useActor`', async () => {
    render(
      <Boundary>
        <Actor />
      </Boundary>,
    )
    expect(screen.getByRole('button').textContent).toBe('idle')

    await act(async () => screen.getByRole('button').click())
    expect(screen.getByTestId('error').textContent).toBe('failed')
  })

  it('throws from `useSelector` outside a provider', async () => {
    render(
      <Boundary>
        <Selected />
      </Boundary>,
    )
    expect(screen.getByRole('button').textContent).toBe('idle')

    await act(async () => screen.getByRole('button').click())
    expect(screen.getByTestId('error').textContent).toBe('failed')
  })
})
