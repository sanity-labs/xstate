import {act, render, screen} from '@testing-library/react'
import {Component, type ReactNode} from 'react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createMachine} from 'xstate'

import {useActor} from '../index'

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

function Actor() {
  const [snapshot, send] = useActor(failing)
  return <button onClick={() => send({type: 'fail'})}>{snapshot.value}</button>
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('an actor that errors', () => {
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
})

function Wrong() {
  useActor({send() {}} as unknown as typeof failing)
  return null
}

describe('passing an actor ref that is not an Actor', () => {
  it('throws', () => {
    expect(() => render(<Wrong />)).toThrow(/expects actor logic/)
  })
})
