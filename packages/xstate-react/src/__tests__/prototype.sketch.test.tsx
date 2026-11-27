import {act, render, screen} from '@testing-library/react'
import {startTransition, useActionState, useLayoutEffect, useState} from 'react'
import {describe, expect, it} from 'vitest'
import {createMachine, types} from 'xstate'
import {createDurable, type DurableExecutionAdapter} from 'xstate/durable'

import {counterMachine} from './helpers'

/**
 * PALS-175: the sketch taken literally. The initial output from `use(durable.run(input))`, and
 * the durable loop (`waitForEvent` included) inside one `useActionState` action.
 */

/** A host whose `waitForEvent` is fed by `push`. */
function mailbox<TLogic extends typeof counterMachine>(): {
  adapter: DurableExecutionAdapter<TLogic>
  push: (event: unknown) => void
} {
  const inbox: unknown[] = []
  let wake: ((event: unknown) => void) | null = null
  return {
    push: (event) => {
      if (wake) {
        const resolve = wake
        wake = null
        resolve(event)
      } else {
        inbox.push(event)
      }
    },
    adapter: {
      waitForEvent: () =>
        (inbox.length > 0
          ? Promise.resolve(inbox.shift())
          : new Promise((resolve) => {
              wake = resolve
            })) as never,
      executeAction: (action, _metadata, runtime) => action.exec(runtime),
      scheduleTimer: () => {},
      cancelTimer: () => {},
    },
  }
}

describe('`use(durable.run(input))` as the initial output', () => {
  it('resolves only when the machine reaches a final state: it is the machine output, not a snapshot', async () => {
    const {adapter} = mailbox()
    const durable = createDurable(counterMachine, adapter)
    const run = durable.run()
    const outcome = await Promise.race([
      run.then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('still pending after 50ms'), 50)),
    ])
    expect(outcome).toBe('still pending after 50ms')

    const finishing = createMachine({
      schemas: {events: {go: types<void>()}},
      initial: 'idle',
      states: {idle: {on: {go: {target: 'done'}}}, done: {type: 'final'}},
      output: () => ({result: 'done'}),
    })
    const finite = mailbox<never>()
    const finished = createDurable(finishing, finite.adapter as never)
    const output = finished.run()
    finite.push({type: 'go'})
    expect(await output).toEqual({result: 'done'})
  })
})

describe('the durable loop inside one action', () => {
  it('never returns while the machine is active, so the snapshot never updates and `isPending` stays true', async () => {
    const seen: {count: number; pending: boolean}[] = []
    let send!: (event: {type: 'inc'}) => void
    function Sketch() {
      const [{durable, push, initial}] = useState(() => {
        const box = mailbox()
        const execution = createDurable(counterMachine, box.adapter)
        return {durable: execution, push: box.push, initial: execution.initialTransition()[0]}
      })
      const [snapshot, dispatch, isPending] = useActionState(async (_prev: typeof initial) => {
        // The sketch's loop, verbatim apart from recording each iteration.
        /* oxlint-disable eslint/no-await-in-loop */
        let [state, effects] = durable.initialTransition()
        await durable.executeEffects(effects)
        while (state.status === 'active') {
          ;[state, effects] = durable.transition(state, (await durable.waitForEvent()) as never)
          await durable.executeEffects(effects)
          seen.push({count: state.context.count, pending: true})
        }
        /* oxlint-enable eslint/no-await-in-loop */
        return state
      }, initial)
      useLayoutEffect(() => {
        send = (event) => {
          // The first send starts the loop; later ones feed its wait.
          if (seen.length === 0 && !isPending) {
            startTransition(() => dispatch())
          }
          push(event)
        }
      })
      return (
        <p data-testid="state">
          {snapshot.context.count} {String(isPending)}
        </p>
      )
    }
    render(<Sketch />)
    expect(screen.getByTestId('state').textContent).toBe('0 false')

    await act(async () => send({type: 'inc'}))
    await act(async () => send({type: 'inc'}))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    // The loop ran both transitions...
    expect(seen.map((entry) => entry.count)).toEqual([1, 2])
    // ...and React saw none of them: the action has not returned.
    expect(screen.getByTestId('state').textContent).toBe('0 true')
  })
})
