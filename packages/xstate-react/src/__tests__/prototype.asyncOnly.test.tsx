import {act, render, screen} from '@testing-library/react'
import * as React from 'react'
import {describe, expect, it} from 'vitest'
import {createCallbackLogic, createMachine, setup, types} from 'xstate'

import {useDurableActor as useActor} from '../prototypes/useDurableActor'

// The upstream regressions, with the asynchronous flush the prototype needs.
describe('upstream regressions, flushed', () => {
  it('#5272 an invoked callback starts once under StrictMode', async () => {
    let starts = 0
    let cleanups = 0
    const appMachine = createMachine({
      invoke: {
        src: createCallbackLogic(() => {
          starts++
          return () => {
            cleanups++
          }
        }),
      },
    })
    function App() {
      useActor(appMachine)
      return null
    }
    render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
    expect(starts).toBe(0)
    await act(async () => {})
    expect(starts).toBe(1)
    expect(cleanups).toBe(0)
  })

  it('#5074 system.get resolves a sibling invoked actor under StrictMode', async () => {
    const results: string[] = []
    const feedbackMachine = createMachine({})
    const rootMachine = setup({
      actors: {
        feedback: feedbackMachine,
        alert: createCallbackLogic(({system}) => {
          results.push(system.get('feedback') ? 'ok' : 'missing')
        }),
      },
    }).createMachine({
      invoke: [{src: 'feedback', registryKey: 'feedback'}, {src: 'alert'}],
    })
    function App() {
      useActor(rootMachine)
      return null
    }
    render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
    await act(async () => {})
    expect(results).toEqual(['ok'])
  })

  it('#3270 an event sent from a callback ref survives the StrictMode remount', async () => {
    const counterMachine = createMachine({
      schemas: {events: {INCREMENT: types<{}>()}},
      context: {count: 0},
      on: {INCREMENT: ({context}) => ({context: {count: context.count + 1}})},
    })
    function Counter() {
      const [current, send] = useActor(counterMachine)
      const ref = React.useCallback(
        (node: HTMLElement | null) => {
          if (node) {
            send({type: 'INCREMENT'})
          }
        },
        [send],
      )
      return <div ref={ref}>count: {current.context.count}</div>
    }
    render(
      <React.StrictMode>
        <Counter />
      </React.StrictMode>,
    )
    await act(async () => {})
    expect(screen.getByText(/count:/).textContent).toBe('count: 2')
  })

  it('spawns from lazily declared context, once the initial effects ran', async () => {
    let childSpawned = 0
    const machine = createMachine({
      context: ({spawn}) => ({
        ref: spawn(
          createCallbackLogic(() => {
            childSpawned++
          }),
        ),
      }),
    })
    const App = () => {
      useActor(machine)
      return null
    }
    render(<App />)
    expect(childSpawned).toBe(0)
    await act(async () => {})
    expect(childSpawned).toBe(1)
  })
})
