import {fireEvent} from '@testing-library/dom'
import {act, render, screen} from '@testing-library/react'
import {startTransition, Suspense, use, useLayoutEffect} from 'react'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createMachine, types} from 'xstate'

import {useActor} from '../index'
import {counterMachine, deferred, textMachine} from './helpers'

function Field() {
  const [snapshot, send] = useActor(textMachine)
  return (
    <input
      aria-label="text"
      value={snapshot.context.text}
      onChange={(event) => send({type: 'change', text: event.target.value})}
    />
  )
}

describe('a controlled input', () => {
  const global = globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = false
  })
  afterEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('shows what was typed before the transition renders, and keeps the caret', async () => {
    render(<Field />)
    const input = screen.getByLabelText<HTMLInputElement>('text')

    fireEvent.change(input, {target: {value: 'helo'}})
    expect(input.value).toBe('helo')

    input.setSelectionRange(3, 3)
    fireEvent.change(input, {target: {value: 'hello'}})
    input.setSelectionRange(4, 4)
    expect(input.value).toBe('hello')

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(input.value).toBe('hello')
    expect(input.selectionStart).toBe(4)
  })
})

describe('optimistic previews', () => {
  it('apply an event once when a newer snapshot commits while the preview is pending', async () => {
    let app!: ReturnType<typeof useActor<typeof counterMachine>>
    function Counter() {
      const result = useActor(counterMachine, {updates: 'sync'})
      useLayoutEffect(() => {
        app = result
      })
      return <p data-testid="count">{result[0].context.count}</p>
    }
    render(<Counter />)
    const [, send, actor] = app

    const hold = deferred()
    let action!: Promise<void>
    await act(async () => {
      startTransition(() => {
        action = (async () => {
          await Promise.resolve()
          // Outside the transition scope after `await`: an urgent send, previewed until the
          // async action settles.
          send({type: 'inc'})
          await hold.promise
        })()
        return action
      })
    })
    expect(screen.getByTestId('count').textContent).toBe('1')

    // A snapshot that already includes the increment commits while the preview is pending.
    await act(async () => actor.send({type: 'double'}))
    expect(actor.getSnapshot().context.count).toBe(2)
    expect(screen.getByTestId('count').textContent).toBe('2')

    await act(async () => {
      hold.resolve()
      await action
    })
    expect(screen.getByTestId('count').textContent).toBe('2')
  })

  it('rebase an urgent send on the committed snapshot while a transition is pending', async () => {
    const formMachine = createMachine({
      schemas: {
        context: types<{query: string; draft: string}>(),
        events: {search: types<{query: string}>(), type: types<{draft: string}>()},
      },
      context: {query: '', draft: ''},
      on: {
        search: ({event}) => ({context: {query: event.query}}),
        type: ({event}) => ({context: {draft: event.draft}}),
      },
    })
    const results = deferred()
    function Results({query}: {query: string}) {
      if (query) {
        use(results.promise)
      }
      return <p data-testid="query">{query}</p>
    }
    let send!: ReturnType<typeof useActor<typeof formMachine>>[1]
    function Form() {
      const [snapshot, _send] = useActor(formMachine)
      useLayoutEffect(() => {
        send = _send
      })
      return (
        <>
          <p data-testid="draft">{snapshot.context.draft}</p>
          <Suspense fallback={<p data-testid="fallback" />}>
            <Results query={snapshot.context.query} />
          </Suspense>
        </>
      )
    }
    render(<Form />)

    await act(async () => startTransition(() => send({type: 'search', query: 'xstate'})))
    await act(async () => send({type: 'type', draft: 'x'}))

    // The urgent render shows the draft without the pending search, so nothing suspends.
    expect(screen.getByTestId('draft').textContent).toBe('x')
    expect(screen.getByTestId('query').textContent).toBe('')
    expect(screen.queryByTestId('fallback')).toBeNull()

    await act(async () => results.resolve())
    expect(screen.getByTestId('draft').textContent).toBe('x')
    expect(screen.getByTestId('query').textContent).toBe('xstate')
  })
})
